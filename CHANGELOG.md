# Changelog

## 0.1.0 — 2026-08-13

- Initial Cordis Service and four DeepSeek Harness tools.
- Target/Evaluator/Optimizer subagent orchestration.
- Frozen benchmark digests and private rubric isolation.
- Managed Profile mutation, monotonic versions, snapshots and rollback.
- Scoreboards, public/private artifacts and Session ID trace links.

## 0.1.0 harness-integration — 2026-08-14

- Declare `dsh.bundle` and ship `cordis.patch.yml`; the package now installs as a
  profile bundle through `dsh plugin --profile <name> add ...`.
- Add the `./invariant` companion (`self-evolution-invariant`): all-or-nothing
  registration check for the four model-visible tools via the real invariants registry.
- Remove the ambiguous named `name` export next to the default class export.
- Build and validate against the real published `@deepseek-ai/*@0.1.0-rc.6` declarations;
  real-registry registration smoke and real launcher `--dump-config` composition pass.
- Document Model Experience and Known Limitations; correct the install plane
  (bundle layer vs. isolate-realm preset group).

## 0.1.0 docs — 2026-08-14

- Rewrite README: install matrix for `dsh plugin` (npm registry / GitHub / local
  tarball), quick start, badges, contribution notes; ship `scripts/` in the package.
