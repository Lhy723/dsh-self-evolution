import fs from 'node:fs/promises'
import path from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {
  CandidateRoundRecord,
  EvaluateOptions,
  EvaluationCell,
  EvaluationRecord,
  EvolutionRunRecord,
  EvolutionSummary,
  LoadedBenchmark,
  LoadedProfile,
  ProfileState,
  ResolvedEvolutionConfig,
  RunEvolutionOptions,
  Scoreboard,
  StatusSummary,
  WorkerRuntime,
} from './types.js'
import { loadBenchmark } from './benchmark.js'
import { applyCandidate, assertCandidateNotBenchmarkSpecific, validateCandidateProposal } from './candidate.js'
import { loadProfile, computeProfileDigest, setRuntimeVersion } from './profile.js'
import { aggregateEvaluation, collectSessionIds, toPublicEvidence } from './scoring.js'
import { captureSnapshot, listSnapshotVersions, restoreSnapshot, snapshotDirectoryForVersion, verifySnapshot } from './snapshot.js'
import {
  acquireProfileLock,
  appendRunEvent,
  createRunStorage,
  loadProfileState,
  loadScoreboard,
  profileStoragePaths,
  saveProfileState,
  saveRunRecord,
  saveScoreboard,
  scoreboardPath,
  writePrivateArtifact,
  writePublicArtifact,
  type ProfileStoragePaths,
  type RunStorage,
} from './storage.js'
import {
  assertNotAborted,
  ConcurrentProfileChangeError,
  EvolutionError,
  mapPool,
  nowIso,
  redactError,
  resolveExistingDirectory,
} from './util.js'

export interface EvolutionLogger {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

interface StateContext {
  profile: LoadedProfile
  state: ProfileState
  snapshotPath: string
}

interface EvaluationContext {
  parent: Agent
  signal: AbortSignal
  profile: LoadedProfile
  benchmark: LoadedBenchmark
  runsPerCase: number
  kind: EvaluationRecord['kind']
  summary: string
  storage: RunStorage
  workspace: string
  hypothesis?: string
  expectedBehavior?: string
}

export class EvolutionEngine {
  constructor(
    private readonly config: ResolvedEvolutionConfig,
    private readonly worker: WorkerRuntime,
    private readonly logger: EvolutionLogger,
  ) {}

  private workspaceOf(parent: Agent): string {
    return parent.session.header.cwd ?? process.cwd()
  }

  private async ensureState(
    profileDirectory: string,
    paths: ProfileStoragePaths,
    adoptExternalChanges: boolean,
  ): Promise<StateContext> {
    let profile = await loadProfile(profileDirectory, this.config)
    let state = await loadProfileState(paths)
    if (state === undefined) {
      const snapshot = await captureSnapshot(profile.directory, paths.snapshots, profile.runtime.version, this.config)
      state = {
        schemaVersion: 1,
        profilePath: profile.directory,
        currentVersion: profile.runtime.version,
        currentDigest: profile.digest,
        nextVersion: profile.runtime.version + 1,
        updatedAt: nowIso(),
        references: {},
      }
      await saveProfileState(paths, state)
      return { profile, state, snapshotPath: snapshot.path }
    }
    if (state.profilePath !== profile.directory) {
      throw new EvolutionError('stored profile identity does not match the requested real path', 'PROFILE_IDENTITY_MISMATCH')
    }
    if (state.currentDigest !== profile.digest) {
      if (!adoptExternalChanges) {
        throw new ConcurrentProfileChangeError(state.currentDigest, profile.digest)
      }
      let adoptedVersion = profile.runtime.version
      const existingSnapshot = snapshotDirectoryForVersion(paths.snapshots, adoptedVersion)
      const collidesWithCurrent = adoptedVersion <= state.currentVersion
      let snapshotConflict = false
      try {
        const manifest = await verifySnapshot(existingSnapshot)
        snapshotConflict = manifest.profileDigest !== profile.digest
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT'
          && !(error instanceof EvolutionError && error.code === 'MISSING_DIRECTORY')) {
          snapshotConflict = await fs.stat(existingSnapshot).then(() => true).catch(() => false)
        }
      }
      if (collidesWithCurrent || snapshotConflict) {
        adoptedVersion = state.nextVersion
        state.nextVersion += 1
        await setRuntimeVersion(profile.directory, adoptedVersion)
        profile = await loadProfile(profile.directory, this.config)
      } else {
        state.nextVersion = Math.max(state.nextVersion, adoptedVersion + 1)
      }
      const snapshot = await captureSnapshot(profile.directory, paths.snapshots, adoptedVersion, this.config)
      state = {
        ...state,
        currentVersion: adoptedVersion,
        currentDigest: profile.digest,
        references: {},
      }
      await saveProfileState(paths, state)
      this.logger.warn(`adopted externally changed profile as version ${adoptedVersion}`)
      return { profile, state, snapshotPath: snapshot.path }
    }
    if (state.currentVersion !== profile.runtime.version) {
      throw new EvolutionError(
        `profile runtime version ${profile.runtime.version} disagrees with stored version ${state.currentVersion}`,
        'INVALID_STATE',
      )
    }
    const snapshot = await captureSnapshot(profile.directory, paths.snapshots, state.currentVersion, this.config)
    return { profile, state, snapshotPath: snapshot.path }
  }

  private async verifyBenchmarkUnchanged(benchmark: LoadedBenchmark, workspace: string): Promise<void> {
    const reloaded = await loadBenchmark(benchmark.directory, {
      workspace,
      allowInsideWorkspace: this.config.allowBenchmarkInsideWorkspace,
    })
    if (reloaded.digest !== benchmark.digest) {
      throw new EvolutionError('frozen benchmark changed while evaluation was running', 'BENCHMARK_CHANGED', {
        expected: benchmark.digest,
        actual: reloaded.digest,
      })
    }
  }

  private async runEvaluationCell(
    context: EvaluationContext,
    benchmarkCase: LoadedBenchmark['cases'][number],
    runIndex: number,
  ): Promise<EvaluationCell> {
    assertNotAborted(context.signal)
    let target: Awaited<ReturnType<WorkerRuntime['runTarget']>> | undefined
    let targetError: unknown
    for (let attempt = 0; attempt <= this.config.evaluationRetries; attempt += 1) {
      try {
        target = await this.worker.runTarget({
          parent: context.parent,
          signal: context.signal,
          profile: context.profile,
          benchmark: context.benchmark,
          benchmarkCase,
          runIndex,
          ...(context.profile.runtime.toolFilter === undefined ? {} : { toolFilter: context.profile.runtime.toolFilter }),
        })
        break
      } catch (error) {
        targetError = error
        await appendRunEvent(context.storage, 'target-attempt-failed', {
          caseId: benchmarkCase.id,
          run: runIndex,
          attempt: attempt + 1,
          error: redactError(error),
        })
        if (attempt >= this.config.evaluationRetries) throw error
      }
    }
    if (target === undefined) throw targetError

    await writePublicArtifact(context.storage, `targets/${context.profile.runtime.version}/${benchmarkCase.id}-${runIndex}.json`, {
      caseId: benchmarkCase.id,
      run: runIndex,
      profileVersion: context.profile.runtime.version,
      targetSessionId: target.sessionId,
      stopReason: target.stopReason,
      durationMs: target.durationMs,
      output: target.output,
    })

    let evaluator: Awaited<ReturnType<WorkerRuntime['runEvaluator']>> | undefined
    let evaluatorError: unknown
    for (let attempt = 0; attempt <= this.config.evaluatorRetries; attempt += 1) {
      try {
        const result = await this.worker.runEvaluator({
          parent: context.parent,
          signal: context.signal,
          benchmark: context.benchmark,
          benchmarkCase,
          target,
          profileVersion: context.profile.runtime.version,
          runIndex,
        })
        await writePrivateArtifact(
          context.storage,
          `evaluations/${context.profile.runtime.version}/${benchmarkCase.id}-${runIndex}-attempt-${attempt + 1}.json`,
          {
            benchmarkDigest: context.benchmark.digest,
            caseId: benchmarkCase.id,
            run: runIndex,
            statement: benchmarkCase.statement,
            rubric: benchmarkCase.rubric,
            target,
            evaluator: result,
          },
        )
        if (!result.valid) {
          evaluatorError = new EvolutionError(
            `evaluator marked ${benchmarkCase.id} run ${runIndex} invalid`,
            'EVALUATION_INVALID',
            { sessionId: result.sessionId },
          )
          await appendRunEvent(context.storage, 'evaluator-invalid', {
            caseId: benchmarkCase.id,
            run: runIndex,
            attempt: attempt + 1,
            evaluatorSessionId: result.sessionId,
          })
          if (attempt >= this.config.evaluatorRetries) throw evaluatorError
          continue
        }
        evaluator = result
        break
      } catch (error) {
        evaluatorError = error
        await appendRunEvent(context.storage, 'evaluator-attempt-failed', {
          caseId: benchmarkCase.id,
          run: runIndex,
          attempt: attempt + 1,
          error: redactError(error),
        })
        if (attempt >= this.config.evaluatorRetries) throw error
      }
    }
    if (evaluator === undefined) throw evaluatorError

    const privateArtifact = path.join(
      context.storage.privateDirectory,
      'evaluations',
      String(context.profile.runtime.version),
      `${benchmarkCase.id}-${runIndex}-attempt-final.json`,
    )
    await writePrivateArtifact(context.storage, `evaluations/${context.profile.runtime.version}/${benchmarkCase.id}-${runIndex}-attempt-final.json`, {
      benchmarkDigest: context.benchmark.digest,
      caseId: benchmarkCase.id,
      run: runIndex,
      rubric: benchmarkCase.rubric,
      targetSessionId: target.sessionId,
      evaluator,
    })
    await appendRunEvent(context.storage, 'evaluation-cell-completed', {
      caseId: benchmarkCase.id,
      run: runIndex,
      score: evaluator.score,
      targetSessionId: target.sessionId,
      evaluatorSessionId: evaluator.sessionId,
    })
    return {
      caseId: benchmarkCase.id,
      run: runIndex,
      score: evaluator.score,
      publicFeedback: evaluator.publicFeedback,
      behaviorTags: evaluator.behaviorTags,
      targetOutput: target.output,
      targetSessionId: target.sessionId,
      evaluatorSessionId: evaluator.sessionId,
      durationMs: target.durationMs + evaluator.durationMs,
      privateArtifact,
    }
  }

  private async evaluateProfile(context: EvaluationContext): Promise<EvaluationRecord> {
    const startedAtMs = Date.now()
    const cells = context.benchmark.cases.flatMap(benchmarkCase =>
      Array.from({ length: context.runsPerCase }, (_, index) => ({ benchmarkCase, runIndex: index + 1 })))
    await appendRunEvent(context.storage, 'evaluation-started', {
      profileVersion: context.profile.runtime.version,
      profileDigest: context.profile.digest,
      benchmarkId: context.benchmark.manifest.id,
      benchmarkDigest: context.benchmark.digest,
      runsPerCase: context.runsPerCase,
      cells: cells.length,
    })
    const results = await mapPool(cells, this.config.maxParallelEvaluations, async cell =>
      this.runEvaluationCell(context, cell.benchmarkCase, cell.runIndex))
    await this.verifyBenchmarkUnchanged(context.benchmark, context.workspace)
    const actualProfileDigest = await computeProfileDigest(context.profile.directory, this.config)
    if (actualProfileDigest !== context.profile.digest) {
      throw new ConcurrentProfileChangeError(context.profile.digest, actualProfileDigest)
    }
    const evaluation = aggregateEvaluation({
      kind: context.kind,
      benchmark: context.benchmark,
      profileVersion: context.profile.runtime.version,
      profileDigest: context.profile.digest,
      runsPerCase: context.runsPerCase,
      cells: results,
      startedAtMs,
      summary: context.summary,
      ...(context.hypothesis === undefined ? {} : { hypothesis: context.hypothesis }),
      ...(context.expectedBehavior === undefined ? {} : { expectedBehavior: context.expectedBehavior }),
    })
    await writePublicArtifact(context.storage, `evaluations/v${context.profile.runtime.version}-${evaluation.id}.json`, {
      ...evaluation,
      cases: evaluation.cases.map(caseEvaluation => ({
        ...caseEvaluation,
        runs: caseEvaluation.runs.map(run => ({
          caseId: run.caseId,
          run: run.run,
          score: run.score,
          publicFeedback: run.publicFeedback,
          behaviorTags: run.behaviorTags,
          targetOutput: run.targetOutput,
          targetSessionId: run.targetSessionId,
          evaluatorSessionId: run.evaluatorSessionId,
          durationMs: run.durationMs,
        })),
      })),
    })
    await appendRunEvent(context.storage, 'evaluation-completed', {
      evaluationId: evaluation.id,
      profileVersion: evaluation.profileVersion,
      score: evaluation.score,
    })
    return evaluation
  }

  private referenceFor(scoreboard: Scoreboard, profile: LoadedProfile): EvaluationRecord | undefined {
    return [...scoreboard.entries].reverse().find(entry =>
      entry.benchmarkDigest === scoreboard.benchmarkDigest
      && entry.profileVersion === profile.runtime.version
      && entry.profileDigest === profile.digest)
  }

  private async proposeCandidate(input: {
    parent: Agent
    signal: AbortSignal
    profile: LoadedProfile
    benchmark: LoadedBenchmark
    reference: EvaluationRecord
    rounds: CandidateRoundRecord[]
    storage: RunStorage
  }): Promise<{ optimizerSessionId: string; candidate: ReturnType<typeof validateCandidateProposal> } | undefined> {
    let lastError: unknown
    for (let attempt = 0; attempt <= this.config.optimizerRetries; attempt += 1) {
      try {
        const optimized = await this.worker.runOptimizer({
          parent: input.parent,
          signal: input.signal,
          profile: input.profile,
          benchmark: input.benchmark,
          evidence: toPublicEvidence(input.benchmark, input.reference, input.rounds),
          priorCandidates: input.rounds,
        })
        const candidate = validateCandidateProposal(optimized.proposal, input.profile, this.config)
        assertCandidateNotBenchmarkSpecific(candidate, input.benchmark)
        await appendRunEvent(input.storage, 'optimizer-completed', {
          attempt: attempt + 1,
          optimizerSessionId: optimized.sessionId,
          operations: candidate.operations.length,
          totalBytes: candidate.totalBytes,
          summary: candidate.summary,
        })
        return { optimizerSessionId: optimized.sessionId, candidate }
      } catch (error) {
        lastError = error
        await appendRunEvent(input.storage, 'optimizer-attempt-failed', {
          attempt: attempt + 1,
          error: redactError(error),
        })
      }
    }
    this.logger.warn(`optimizer could not produce a valid candidate: ${redactError(lastError)}`)
    return undefined
  }

  private async initializeRunRecord(
    storage: RunStorage,
    mode: EvolutionRunRecord['mode'],
    profilePath: string,
    benchmark?: LoadedBenchmark,
  ): Promise<EvolutionRunRecord> {
    const record: EvolutionRunRecord = {
      schemaVersion: 1,
      runId: storage.runId,
      mode,
      profilePath,
      ...(benchmark === undefined ? {} : {
        benchmarkPath: benchmark.directory,
        benchmarkId: benchmark.manifest.id,
        benchmarkDigest: benchmark.digest,
      }),
      startedAt: nowIso(),
      status: 'running',
      rounds: [],
    }
    await saveRunRecord(storage, record)
    return record
  }

  async evaluate(parent: Agent, signal: AbortSignal, options: EvaluateOptions): Promise<EvolutionSummary> {
    const workspace = await resolveExistingDirectory(this.workspaceOf(parent))
    const profileDirectory = await resolveExistingDirectory(options.profileDir)
    const paths = profileStoragePaths(this.config, profileDirectory)
    const lock = await acquireProfileLock(paths, this.config, signal)
    let storage: RunStorage | undefined
    let record: EvolutionRunRecord | undefined
    try {
      const stateContext = await this.ensureState(profileDirectory, paths, options.adoptExternalChanges)
      const benchmark = await loadBenchmark(options.benchmarkDir, {
        workspace,
        allowInsideWorkspace: this.config.allowBenchmarkInsideWorkspace,
      })
      storage = await createRunStorage(paths, 'evaluate')
      record = await this.initializeRunRecord(storage, 'evaluate', stateContext.profile.directory, benchmark)
      stateContext.state.latestRunId = storage.runId
      await saveProfileState(paths, stateContext.state)
      const evaluation = await this.evaluateProfile({
        parent,
        signal,
        profile: stateContext.profile,
        benchmark,
        runsPerCase: options.runsPerCase,
        kind: 'manual-evaluation',
        summary: `Manual evaluation of profile version ${stateContext.profile.runtime.version}`,
        storage,
        workspace,
      })
      const scoreboard = await loadScoreboard(paths, benchmark.manifest.id, benchmark.digest)
      scoreboard.entries.push(evaluation)
      const boardPath = await saveScoreboard(paths, scoreboard)
      stateContext.state.references[benchmark.digest] = {
        benchmarkId: benchmark.manifest.id,
        benchmarkDigest: benchmark.digest,
        profileVersion: evaluation.profileVersion,
        profileDigest: evaluation.profileDigest,
        evaluationId: evaluation.id,
        score: evaluation.score,
        runsPerCase: evaluation.runsPerCase,
      }
      await saveProfileState(paths, stateContext.state)
      record.baseline = evaluation
      record.finalVersion = evaluation.profileVersion
      record.finalScore = evaluation.score
      record.stopReason = 'evaluation-completed'
      record.status = 'completed'
      record.finishedAt = nowIso()
      await saveRunRecord(storage, record)
      return {
        ok: true,
        runId: storage.runId,
        mode: 'evaluate',
        profilePath: stateContext.profile.directory,
        benchmarkId: benchmark.manifest.id,
        baselineScore: evaluation.score,
        finalScore: evaluation.score,
        finalVersion: evaluation.profileVersion,
        acceptedRounds: 0,
        rejectedRounds: 0,
        stopReason: 'evaluation-completed',
        runDirectory: storage.directory,
        scoreboardPath: boardPath,
        sessionIds: collectSessionIds(evaluation),
      }
    } catch (error) {
      if (record !== undefined && storage !== undefined) {
        record.status = signal.aborted ? 'aborted' : 'failed'
        record.error = redactError(error)
        record.stopReason = signal.aborted ? 'aborted' : 'failed'
        record.finishedAt = nowIso()
        await saveRunRecord(storage, record).catch(() => undefined)
      }
      throw error
    } finally {
      await lock.release()
    }
  }

  async evolve(parent: Agent, signal: AbortSignal, options: RunEvolutionOptions): Promise<EvolutionSummary> {
    const workspace = await resolveExistingDirectory(this.workspaceOf(parent))
    const profileDirectory = await resolveExistingDirectory(options.profileDir)
    const paths = profileStoragePaths(this.config, profileDirectory)
    const lock = await acquireProfileLock(paths, this.config, signal)
    let storage: RunStorage | undefined
    let record: EvolutionRunRecord | undefined
    try {
      let stateContext = await this.ensureState(profileDirectory, paths, options.adoptExternalChanges)
      const benchmark = await loadBenchmark(options.benchmarkDir, {
        workspace,
        allowInsideWorkspace: this.config.allowBenchmarkInsideWorkspace,
      })
      storage = await createRunStorage(paths, 'evolve')
      record = await this.initializeRunRecord(storage, 'evolve', stateContext.profile.directory, benchmark)
      stateContext.state.latestRunId = storage.runId
      await saveProfileState(paths, stateContext.state)

      const scoreboard = await loadScoreboard(paths, benchmark.manifest.id, benchmark.digest)
      let reference = this.referenceFor(scoreboard, stateContext.profile)
      if (reference === undefined) {
        reference = await this.evaluateProfile({
          parent,
          signal,
          profile: stateContext.profile,
          benchmark,
          runsPerCase: options.baselineRuns,
          kind: 'baseline',
          summary: `Formal baseline for profile version ${stateContext.profile.runtime.version}`,
          storage,
          workspace,
        })
        scoreboard.entries.push(reference)
        await saveScoreboard(paths, scoreboard)
      } else {
        await appendRunEvent(storage, 'reference-reused', {
          evaluationId: reference.id,
          profileVersion: reference.profileVersion,
          score: reference.score,
          runsPerCase: reference.runsPerCase,
        })
      }
      record.baseline = reference
      stateContext.state.references[benchmark.digest] = {
        benchmarkId: benchmark.manifest.id,
        benchmarkDigest: benchmark.digest,
        profileVersion: reference.profileVersion,
        profileDigest: reference.profileDigest,
        evaluationId: reference.id,
        score: reference.score,
        runsPerCase: reference.runsPerCase,
      }
      await saveProfileState(paths, stateContext.state)

      let currentProfile = stateContext.profile
      let currentSnapshot = stateContext.snapshotPath
      let stopReason = 'round-limit-reached'
      if (options.targetScore !== undefined && reference.score >= options.targetScore) {
        stopReason = 'target-score-already-reached'
      } else {
        for (let roundIndex = 1; roundIndex <= options.rounds; roundIndex += 1) {
          assertNotAborted(signal)
          const proposed = await this.proposeCandidate({
            parent,
            signal,
            profile: currentProfile,
            benchmark,
            reference,
            rounds: record.rounds,
            storage,
          })
          if (proposed === undefined) {
            stopReason = 'optimizer-produced-no-valid-candidate'
            break
          }

          const candidateVersion = stateContext.state.nextVersion
          stateContext.state.nextVersion += 1
          await saveProfileState(paths, stateContext.state)
          const roundRecord: CandidateRoundRecord = {
            round: roundIndex,
            version: candidateVersion,
            proposal: proposed.candidate,
            optimizerSessionId: proposed.optimizerSessionId,
            beforeDigest: currentProfile.digest,
            decision: 'blocked',
            reason: 'candidate-not-yet-evaluated',
            snapshotPath: currentSnapshot,
          }
          record.rounds.push(roundRecord)
          await writePublicArtifact(storage, `candidates/v${candidateVersion}-proposal.json`, {
            version: candidateVersion,
            optimizerSessionId: proposed.optimizerSessionId,
            candidate: proposed.candidate,
          })
          await saveRunRecord(storage, record)

          let candidateProfile: LoadedProfile
          try {
            candidateProfile = await applyCandidate(
              currentProfile,
              proposed.candidate,
              candidateVersion,
              this.config,
            )
            roundRecord.candidateDigest = candidateProfile.digest
            await appendRunEvent(storage, 'candidate-applied', {
              round: roundIndex,
              version: candidateVersion,
              beforeDigest: currentProfile.digest,
              candidateDigest: candidateProfile.digest,
            })
          } catch (error) {
            roundRecord.reason = `candidate-apply-failed: ${redactError(error)}`
            await saveRunRecord(storage, record)
            stopReason = 'candidate-apply-failed'
            break
          }

          let candidateEvaluation: EvaluationRecord
          try {
            candidateEvaluation = await this.evaluateProfile({
              parent,
              signal,
              profile: candidateProfile,
              benchmark,
              runsPerCase: options.runsPerCase,
              kind: 'candidate',
              summary: proposed.candidate.summary,
              hypothesis: proposed.candidate.hypothesis,
              expectedBehavior: proposed.candidate.expectedBehavior,
              storage,
              workspace,
            })
          } catch (error) {
            const actualDigest = await computeProfileDigest(candidateProfile.directory, this.config)
            if (actualDigest === candidateProfile.digest) {
              await restoreSnapshot(currentSnapshot, currentProfile.directory, candidateProfile.digest, this.config)
            }
            roundRecord.reason = `candidate-evaluation-failed: ${redactError(error)}`
            await saveRunRecord(storage, record)
            throw error
          }
          roundRecord.evaluation = candidateEvaluation

          const actualDigest = await computeProfileDigest(candidateProfile.directory, this.config)
          if (actualDigest !== candidateProfile.digest) {
            roundRecord.decision = 'blocked'
            roundRecord.reason = 'profile-changed-during-candidate-evaluation'
            await saveRunRecord(storage, record)
            throw new ConcurrentProfileChangeError(candidateProfile.digest, actualDigest)
          }

          const accepted = candidateEvaluation.score > reference.score + this.config.minImprovement
          if (accepted) {
            const acceptedEvaluation: EvaluationRecord = { ...candidateEvaluation, kind: 'accepted-candidate' }
            const snapshot = await captureSnapshot(
              candidateProfile.directory,
              paths.snapshots,
              candidateVersion,
              this.config,
            )
            scoreboard.entries.push(acceptedEvaluation)
            await saveScoreboard(paths, scoreboard)
            stateContext.state.currentVersion = candidateVersion
            stateContext.state.currentDigest = candidateProfile.digest
            stateContext.state.references[benchmark.digest] = {
              benchmarkId: benchmark.manifest.id,
              benchmarkDigest: benchmark.digest,
              profileVersion: acceptedEvaluation.profileVersion,
              profileDigest: acceptedEvaluation.profileDigest,
              evaluationId: acceptedEvaluation.id,
              score: acceptedEvaluation.score,
              runsPerCase: acceptedEvaluation.runsPerCase,
            }
            await saveProfileState(paths, stateContext.state)
            roundRecord.evaluation = acceptedEvaluation
            roundRecord.decision = 'accepted'
            roundRecord.reason = `score improved from ${reference.score} to ${acceptedEvaluation.score}`
            reference = acceptedEvaluation
            currentProfile = candidateProfile
            currentSnapshot = snapshot.path
            await appendRunEvent(storage, 'candidate-accepted', {
              round: roundIndex,
              version: candidateVersion,
              score: acceptedEvaluation.score,
            })
          } else {
            const restored = await restoreSnapshot(
              currentSnapshot,
              currentProfile.directory,
              candidateProfile.digest,
              this.config,
            )
            if (restored !== currentProfile.digest) {
              throw new EvolutionError('rejected candidate rollback did not restore the reference digest', 'RESTORE_FAILED')
            }
            roundRecord.decision = 'rejected'
            roundRecord.reason = `score ${candidateEvaluation.score} did not exceed reference ${reference.score} by more than ${this.config.minImprovement}`
            await appendRunEvent(storage, 'candidate-rejected', {
              round: roundIndex,
              version: candidateVersion,
              score: candidateEvaluation.score,
              referenceScore: reference.score,
            })
          }
          await saveRunRecord(storage, record)

          if (options.targetScore !== undefined && reference.score >= options.targetScore) {
            stopReason = 'target-score-reached'
            break
          }
        }
      }

      const boardPath = scoreboardPath(paths, benchmark.manifest.id)
      record.finalVersion = reference.profileVersion
      record.finalScore = reference.score
      record.stopReason = stopReason
      record.status = 'completed'
      record.finishedAt = nowIso()
      await saveRunRecord(storage, record)
      stateContext.state.latestRunId = storage.runId
      await saveProfileState(paths, stateContext.state)
      const allSessionIds = [
        ...collectSessionIds(record.baseline),
        ...record.rounds.flatMap(roundRecord => [
          roundRecord.optimizerSessionId,
          ...collectSessionIds(roundRecord.evaluation),
        ]),
      ]
      return {
        ok: true,
        runId: storage.runId,
        mode: 'evolve',
        profilePath: profileDirectory,
        benchmarkId: benchmark.manifest.id,
        baselineScore: record.baseline?.score,
        finalScore: reference.score,
        finalVersion: reference.profileVersion,
        acceptedRounds: record.rounds.filter(item => item.decision === 'accepted').length,
        rejectedRounds: record.rounds.filter(item => item.decision === 'rejected').length,
        stopReason,
        runDirectory: storage.directory,
        scoreboardPath: boardPath,
        sessionIds: [...new Set(allSessionIds)],
      }
    } catch (error) {
      if (record !== undefined && storage !== undefined) {
        record.status = signal.aborted ? 'aborted' : 'failed'
        record.error = redactError(error)
        record.stopReason = signal.aborted ? 'aborted' : 'failed'
        record.finishedAt = nowIso()
        await saveRunRecord(storage, record).catch(() => undefined)
      }
      throw error
    } finally {
      await lock.release()
    }
  }

  async rollback(parent: Agent, signal: AbortSignal, profileDir: string, version: number): Promise<EvolutionSummary> {
    void parent
    const profileDirectory = await resolveExistingDirectory(profileDir)
    const paths = profileStoragePaths(this.config, profileDirectory)
    const lock = await acquireProfileLock(paths, this.config, signal)
    let storage: RunStorage | undefined
    let record: EvolutionRunRecord | undefined
    try {
      const current = await this.ensureState(profileDirectory, paths, false)
      const snapshotPath = snapshotDirectoryForVersion(paths.snapshots, version)
      const manifest = await verifySnapshot(snapshotPath)
      storage = await createRunStorage(paths, 'rollback')
      record = await this.initializeRunRecord(storage, 'rollback', current.profile.directory)
      const restored = await restoreSnapshot(snapshotPath, current.profile.directory, current.profile.digest, this.config)
      current.state.currentVersion = version
      current.state.currentDigest = restored
      current.state.nextVersion = Math.max(current.state.nextVersion, version + 1)
      current.state.latestRunId = storage.runId
      current.state.references = Object.fromEntries(
        Object.entries(current.state.references).filter(([, reference]) =>
          reference.profileVersion === version && reference.profileDigest === restored),
      )
      await saveProfileState(paths, current.state)
      record.finalVersion = version
      record.stopReason = `restored snapshot v${version}`
      record.status = 'completed'
      record.finishedAt = nowIso()
      await saveRunRecord(storage, record)
      return {
        ok: true,
        runId: storage.runId,
        mode: 'rollback',
        profilePath: current.profile.directory,
        finalVersion: version,
        acceptedRounds: 0,
        rejectedRounds: 0,
        stopReason: `restored snapshot v${version} (${manifest.profileDigest.slice(0, 12)})`,
        runDirectory: storage.directory,
        sessionIds: [],
      }
    } catch (error) {
      if (record !== undefined && storage !== undefined) {
        record.status = signal.aborted ? 'aborted' : 'failed'
        record.error = redactError(error)
        record.stopReason = signal.aborted ? 'aborted' : 'failed'
        record.finishedAt = nowIso()
        await saveRunRecord(storage, record).catch(() => undefined)
      }
      throw error
    } finally {
      await lock.release()
    }
  }

  async status(profileDir: string): Promise<StatusSummary> {
    const profileDirectory = await resolveExistingDirectory(profileDir)
    const profile = await loadProfile(profileDirectory, this.config)
    const paths = profileStoragePaths(this.config, profileDirectory)
    const state = await loadProfileState(paths)
    if (state === undefined) {
      return {
        profilePath: profile.directory,
        statePath: paths.state,
        currentVersion: profile.runtime.version,
        currentDigest: profile.digest,
        actualDigest: profile.digest,
        drifted: false,
        nextVersion: profile.runtime.version + 1,
        references: {},
        snapshots: await listSnapshotVersions(paths.snapshots),
      }
    }
    const actualDigest = await computeProfileDigest(profile.directory, this.config)
    return {
      profilePath: profile.directory,
      statePath: paths.state,
      currentVersion: state.currentVersion,
      currentDigest: state.currentDigest,
      actualDigest,
      drifted: actualDigest !== state.currentDigest,
      nextVersion: state.nextVersion,
      ...(state.latestRunId === undefined ? {} : { latestRunId: state.latestRunId }),
      references: state.references,
      snapshots: await listSnapshotVersions(paths.snapshots),
    }
  }
}
