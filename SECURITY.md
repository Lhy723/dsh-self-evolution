# Security model

## Protected by the plugin

### Candidate writes

Candidate operations are limited to configured managed glob patterns. The engine rejects:

- absolute paths;
- `..` traversal;
- NUL bytes;
- symlink traversal;
- excluded secret-like paths;
- deletion of required files;
- duplicate operations on one path;
- candidates over operation or byte budgets.

Writes are atomic per file. Partial application records original bytes and performs a conflict-aware rollback.

### Rollback safety

A snapshot restore requires the live Profile digest to equal the expected Candidate or current digest. This prevents a stale self-evolution process from silently overwriting a human or another process.

### Context isolation

- Target prompts never contain private rubric text.
- Optimizer prompts never contain rubric text, rubric paths, private evaluator notes, or private artifacts.
- Evaluator and Optimizer children receive an empty inherited-tool allowlist and can only use their child-scoped structured-output mechanism.

### Benchmark immutability

The engine hashes manifest, Statements and Rubrics. A digest change during evaluation or against an existing Scoreboard is fatal.

## Not protected by the plugin

This package is not an operating-system sandbox and does not make an unrestricted Target safe.

A Target inheriting a full-access shell or filesystem tool may be able to search outside its workspace, including private Benchmark or state directories, even though their paths are not in its prompt. DeepSeek Harness sandbox and filesystem policy remain the enforcement boundary.

Recommended production posture:

1. Store private Benchmarks outside the Target workspace.
2. Keep `allowBenchmarkInsideWorkspace: false`.
3. Run Target children under a workspace-confined sandbox.
4. Deny host-wide shell/filesystem tools in `runtime.json.toolFilter` unless the Benchmark requires them.
5. Store `stateRoot` in a user-private directory and protect it with OS permissions.
6. Do not place secrets in managed Profile files. Default exclusions are defense in depth, not secret scanning.
7. Keep Evaluator/Optimizer models and providers under operator control.

## Prompt injection

A public Benchmark Statement or Target output may contain adversarial instructions. Evaluator and Optimizer personas explicitly delimit roles, but model-level prompt injection cannot be eliminated by prose alone. Tool isolation and deterministic candidate validation limit the consequences: the optimizer cannot read files, and proposed writes must pass the host mutation contract.

## Reporting vulnerabilities

When reporting a vulnerability, include:

- plugin version;
- DeepSeek Harness commit/version;
- Cordis composition and sandbox mode;
- redacted Profile and Benchmark structure;
- run ID and relevant host `events.jsonl` entries;
- whether the Target had host-wide shell/filesystem access.
