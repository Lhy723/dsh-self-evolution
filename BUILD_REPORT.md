# Build report

This file records what a release build of `dsh-self-evolution@0.1.1` was
validated against, so contributors and reviewers can reproduce the checks.

- Package: `dsh-self-evolution@0.1.1`
- Build date: 2026-08-14
- TypeScript: 5.8.3
- Node used for validation: 24.14.1
- DeepSeek Harness API target: the published `@deepseek-ai/*@0.1.0-rc.6`
  packages (designed against commit `47f943859bef60e4160492346772ded9b24f765a`
  of `deepseek-ai/deepseek-harness`, the `0.1.0-rc.5` family)

## How to reproduce

```bash
npm install --no-save typescript@5.8.3   # toolchain only
npm run build                             # strict build against real rc.6 declarations
node scripts/smoke-register.mjs           # registration smoke on real dsh-tools / dsh-invariants
DSH_HOME=$PWD/.dsh-test dsh --profile smoke --dump-config   # real-launcher composition
npm pack
```

The real `@deepseek-ai/*` packages are published on the npm registry; the
registration smoke and the launcher check additionally need a `dsh` binary on
`PATH` (see `COMPATIBILITY.md`).

## Result

- **Strict TypeScript build against real `@deepseek-ai/*@0.1.0-rc.6` declarations: passed.**
  Compiling against the real surface (instead of offline shape declarations)
  required four changes:
  1. a side-effect import that activates the `ctx.subagents` Context augmentation;
  2. the real `ContentBlock` union in `textFromContentBlocks`;
  3. `ObjectJsonSchema` typing for the evaluator/optimizer output schemas,
     checked at compile time with `satisfies`;
  4. `STATUS_SCHEMA.additionalProperties: false` so the inferred output type
     matches `StatusSummary`.
- **Real-runtime registration smoke: passed.** The four `evolution_*` tools
  register through the real `dsh-tools` registry (each schema therefore passes
  the real `assertSupportedJsonSchema` subset), the `./invariant` companion
  registers through the real `dsh-invariants` registry, and disposing the
  plugin fiber removes every tool (HMR-safe).
- **Real-launcher composition: passed.** `dsh --profile smoke --dump-config`
  applies the bundle's `cordis.patch.yml` over `@deepseek-ai/dsh-base` and
  prints the `self-evolution` row under `# == dsh-self-evolution` with no
  skipped-patch warnings.
- **npm package dry-run: passed.**

## Scope of this build

Live model runs were not part of this build: the validation environment has no
model endpoint or credentials. The remaining end-to-end checks (real
`evolution_evaluate` / `evolution_run` with Session ID tracing) are listed in
`COMPATIBILITY.md` under "Recommended smoke test".
