# Build report

- Package: `dsh-self-evolution@0.1.0`
- Build date: 2026-08-14 (harness-integration pass)
- TypeScript: 5.8.3
- Node used for validation: 24.14.1
- DeepSeek Harness API target: real published `@deepseek-ai/*@0.1.0-rc.6` type declarations
  (design reference: commit `47f943859bef60e4160492346772ded9b24f765a`, `0.1.0-rc.5` family)

## Commands

```bash
npm install --no-save typescript@5.8.3   # toolchain only
npm run build                             # strict build against REAL rc.6 declarations
npm test                                  # 9 offline suites against dist
node scripts/smoke-register.mjs           # real dsh-tools / dsh-invariants registries
DSH_HOME=$PWD/.dsh-test dsh --profile smoke --dump-config   # real launcher composition
npm pack
```

## Result

- Strict TypeScript build against the REAL `@deepseek-ai/*` rc.6 declarations: passed.
  The real surface required four fixes over the offline-shape build:
  1. side-effect import activating the `ctx.subagents` Context augmentation (dsh-subagent);
  2. real `ContentBlock` union in `textFromContentBlocks` (dsh-llm);
  3. `ObjectJsonSchema` typing for evaluator/optimizer output schemas (dsh-tools subset,
     checked at compile time via `satisfies`);
  4. `STATUS_SCHEMA.additionalProperties` changed to `false` so the real `InferValue`
     matches `StatusSummary`.
- Node test suites: 9 tests, 9 passed, 0 failed.
- Real-runtime registration smoke: passed. The four `evolution_*` tools register through
  the real `dsh-tools` registry (every tool schema therefore passes the real
  `assertSupportedJsonSchema` subset), the `./invariant` companion registers through the
  real `dsh-invariants` registry, and disposing the plugin fiber removes every tool
  (HMR-safe).
- Real launcher composition: passed. `dsh --profile smoke --dump-config` (DSH_HOME at
  `.dsh-test/`) applies the bundle's `cordis.patch.yml` over `@deepseek-ai/dsh-base` and
  prints the `self-evolution` row under `# == dsh-self-evolution` with no skipped-patch
  warnings.
- npm package dry-run: passed.

## Environment limitation

The delivery environment still has no model endpoint or credentials, so a live
LLM/Subagent end-to-end run was not performed. See `COMPATIBILITY.md` for the destination
smoke-test procedure.
