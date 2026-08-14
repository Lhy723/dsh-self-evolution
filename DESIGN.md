# Design: Benchmark-driven evolution as a Cordis capability

## 1. Boundary ownership

The plugin deliberately separates probabilistic work from deterministic policy.

### LLM-owned

- Target answer generation;
- rubric-based judgement;
- public diagnostic feedback;
- one bounded candidate proposal and its falsifiable hypothesis.

### Host-owned

- benchmark loading and digesting;
- profile mutation surface;
- snapshots and restore verification;
- version reservation;
- Case × Run scheduling;
- retry accounting;
- score aggregation;
- strict accept/reject decision;
- scoreboard persistence;
- private/public artifact separation.

The optimizer cannot decide that its own candidate is accepted.

## 2. Cordis / DeepSeek Harness integration

`SelfEvolutionService` is a Cordis `Service` named `evolution` with hard injections on `tools` and `subagents`.

The four model-visible tools are registered through the canonical `defineTool` path. All long operations are exclusive by default; status is explicitly concurrency-safe.

`DshSubagentWorker` calls `ctx.subagents.start(provider, request)` directly:

- Target: profile persona + profile ToolRestriction;
- Evaluator: private rubric + raw target output + structured schema + `allow: []`;
- Optimizer: public evidence + complete managed profile + structured candidate schema + `allow: []`.

DeepSeek Harness installs the structured-output reporting tool in the child's own scope after applying the inherited-tool restriction, so the child retains only the reporting channel.

## 3. Profile model

The managed Profile is not an opaque database row. It is a versioned directory whose digest covers every managed file.

`runtime.json` is the only machine-interpreted profile file. `AGENTS.md`, Skills, and config files become model-facing persona context.

Changing `runtime.json.toolFilter` changes the DeepSeek child composition without changing plugin source. This is the main runtime-reorganization seam.

## 4. Benchmark privacy

The Benchmark object held by host code contains both Statement and Rubric. The Target receives only Statement. The Optimizer prompt is constructed from:

- public Statement;
- target output;
- numeric scores;
- evaluator `publicFeedback` and behavior tags;
- prior candidate outcomes;
- current managed profile.

Rubric text, rubric paths, evaluator private notes, and gold material are not serialized into that prompt.

Private artifact files are stored separately from public run artifacts. This is a context boundary, not a hardened filesystem boundary; see SECURITY.md.

## 5. Snapshot and transaction model

A snapshot is a directory with:

- immutable copy of each managed file;
- SHA-256 per file;
- deterministic inventory digest;
- Profile real path and version.

Before modifying a Reference, its snapshot must exist. A rejected Candidate restores that snapshot only when the current digest still equals the evaluated Candidate digest. If another process changed a managed file, rollback refuses to overwrite it.

Candidate application itself records exact original bytes and rolls back partial writes only when current bytes still match what the transaction wrote.

## 6. Version semantics

- The initial version comes from `runtime.json`.
- A Candidate version is reserved before application.
- Reserved versions are never reused, including rejected or failed Candidates.
- Manual external changes require explicit adoption. If their version collides, the engine assigns the next monotonic version.
- Manual rollback changes the current version but does not decrease `nextVersion`.

## 7. Evaluation semantics

Each matrix cell has one Target run and one successful Evaluator judgement. Target failures may rerun the Target. Evaluator failures retry against the same Target output, avoiding accidental reruns of the behavior being scored.

Case score is the arithmetic mean of its Runs. Evaluation score is the weighted mean of Case scores. Values are rounded to two decimals.

Candidate acceptance is:

```text
candidate.score > reference.score + minImprovement
```

Anything else is rejected and restored.

## 8. Persistence model

The DeepSeek Session log remains the authoritative trace for each subagent. Plugin state records Session IDs and adds a compact host-side event log for orchestration decisions.

Scoreboards store Baselines, manual References, and accepted Candidates. Rejected Candidate evaluations remain in their run record but do not become Scoreboard References.
