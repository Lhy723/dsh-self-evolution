# Compatibility and validation

## Targeted DeepSeek Harness surface

This release was implemented against the public source tree at:

- repository: `deepseek-ai/deepseek-harness`
- commit: `47f943859bef60e4160492346772ded9b24f765a`
- root release family: `0.1.0-rc.5` (designed against); **verified to build and register against the published `0.1.0-rc.6` family**, which npm resolves for every `@deepseek-ai/dsh-*` peer. The peer ranges (`^0.1.0-rc.5`) admit rc.6.
- Node requirement used by that tree: Node 22.19+ or 24+

The plugin depends on the following stable public seams from that revision:

- Cordis class Plugins and `Service` registration;
- `ctx.tools.register(defineTool(...))`;
- `ctx.subagents.start(provider, request)`;
- Subagent request fields `parent`, `prompt`, `signal`, `agentOptions`, `outputSchema`, `maxDepth`, `toolFilter`, and `persona`;
- `SubagentRun.id`, `.result`, and `.dispose()`;
- per-child Tool Restriction semantics where child-owned structured-output tools remain visible after inherited capabilities are filtered.

The package declares DeepSeek Harness `0.1.0-rc.5` peers for the DSH packages and leaves Cordis/Schemastery versions open. All named peers (`@deepseek-ai/dsh-agent`, `dsh-llm`, `dsh-subagent`, `dsh-tools`, `cordis`, `schemastery`) are published on the npm registry under the rc.6 family, so the peer ranges resolve normally. `dsh plugin` profiles disable peer auto-install and rely on the harness-managed `$DSH_HOME/profiles/node_modules` fallback at runtime.

## Validation performed

- Strict TypeScript build completed with TypeScript 5.8.3 against the real `@deepseek-ai/*@0.1.0-rc.6` type declarations (the registry resolves the whole rc.6 family), not offline mock shapes. Fixes required by the real surface: activating the `ctx.subagents` Context augmentation, real `ContentBlock`/`ObjectJsonSchema` types, and a real-inference-correct `STATUS_SCHEMA`.
- Real-runtime registration smoke (`scripts/smoke-register.mjs`) passed against the real `dsh-tools` registry and `dsh-invariants` registry: the four `evolution_*` tools register (so every tool schema passes the real `assertSupportedJsonSchema` subset), the `./invariant` companion registers, and disposing the plugin fiber removes every registration (HMR-safe).
- Bundle composition verified with the real launcher: `dsh --profile smoke --dump-config` (DSH_HOME pointing at this repository's `.dsh-test`) composes `@deepseek-ai/dsh-base` plus this package's `cordis.patch.yml` and prints the `self-evolution` row under `# == dsh-self-evolution`, with no skipped-patch warnings.
- Live model runs were not part of this validation (no model endpoint or credentials in the validation environment). The remaining end-to-end checks are listed below; run them in your own deployment with its provider, sandbox, persistence, and approval policy.

## Recommended smoke test

Run these checks once in a real deployment before enabling unattended optimization:

1. `dsh plugin --profile <name> add ./dsh-self-evolution-<version>.tgz`, then confirm `dsh --profile <name> --dump-config` shows the `self-evolution` row; boot the profile with the official `spawn` subagent provider.
2. Copy `examples/profile` into the Agent workspace.
3. Copy `examples/benchmarks/demo` to a private directory outside that workspace.
4. Call `evolution_evaluate` with one run per case.
5. Confirm:
   - a baseline Scoreboard entry exists;
   - Target and Evaluator Session IDs resolve through the deployment's Session tooling;
   - Evaluator/Optimizer children expose only their structured-output path;
   - private rubric text is absent from public artifacts;
   - the Target sandbox cannot read the private benchmark directory.
6. Run one `evolution_run` round and inspect both accept and reject behavior before enabling unattended optimization.
