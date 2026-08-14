# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.1.0 — 2026-08-14

### Added

- Cordis Service (`ctx.evolution`) with four model-facing tools:
  `evolution_run`, `evolution_evaluate`, `evolution_status`, `evolution_rollback`.
- Target / Evaluator / Optimizer subagent orchestration on
  `ctx.subagents.start(...)`, with per-child Session ID tracking.
- Frozen benchmark digests and private-rubric context isolation.
- Managed Agent Profile mutation: monotonic versions, verified snapshots,
  strict accept-or-rollback semantics, scoreboards and public/private artifacts.
- Profile-bundle packaging (`dsh.bundle` + `cordis.patch.yml`): the package
  installs with `dsh plugin --profile <name> add ...` from npm, GitHub, or a
  local tarball.
- `./invariant` companion (`self-evolution-invariant`): an all-or-nothing
  registration check for the four model-visible tools.

### Changed

- The module now ships only the default class export; the ambiguous extra
  `name` export was removed.
- Build and tests validate against the published `@deepseek-ai/*@0.1.0-rc.6`
  type declarations, including a real-registry registration smoke test and a
  real-launcher `--dump-config` composition check.

### Documentation

- README rewritten as a newcomer-facing guide: feature overview, install
  matrix for `dsh plugin`, quick start, configuration reference, and security
  notes.
- Added Model Experience and Known Limitations sections; documented the two
  supported mount planes (profile bundle layer vs. isolate-realm preset group).
