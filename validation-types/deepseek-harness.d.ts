declare module '@deepseek-ai/cordis' {
  export class Context {
    tools: import('@deepseek-ai/dsh-tools').ToolRuntime
    subagents: import('@deepseek-ai/dsh-subagent').SubagentRuntime
    invariants: import('@deepseek-ai/dsh-invariants').InvariantRegistry
    logger: { info(message: string): void; warn(message: string): void; error(message: string): void }
    on(name: string, listener: (...args: unknown[]) => void, options?: unknown): () => void
  }
  export class Service {
    protected readonly ctx: Context
    constructor(ctx: Context, name: string)
  }
}

declare module '@deepseek-ai/dsh-invariants' {
  export type InvariantFailure = (message: string) => never
  export type InvariantInstaller = {
    (ctx: import('@deepseek-ai/cordis').Context, fail: InvariantFailure): void | Promise<void>
    readonly inject?: readonly string[]
  }
  export interface InvariantRegistry {
    register(packageName: string, installer: InvariantInstaller): () => void
  }
}

declare module '@deepseek-ai/schemastery' {
  const z: any
  export default z
}

declare module '@deepseek-ai/dsh-agent' {
  export interface AgentOptions {
    provider?: string
    model?: string
    maxTokens?: number
  }
  export interface Agent {
    readonly id: string
    readonly options: AgentOptions
    readonly session: {
      readonly header: { readonly id: string; readonly cwd?: string }
    }
  }
}

declare module '@deepseek-ai/dsh-llm' {
  export type ContentBlock =
    | { type: 'text'; text: string }
    | { type: string; [key: string]: unknown }
}

declare module '@deepseek-ai/dsh-subagent' {
  import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent'
  import type { ContentBlock } from '@deepseek-ai/dsh-llm'

  export interface SubagentResult {
    readonly output: ContentBlock[]
    readonly structured?: unknown
    readonly stopReason: string
  }
  export interface SubagentRun {
    readonly id: string
    readonly result: Promise<SubagentResult>
    dispose(): Promise<void>
  }
  export interface SubagentRuntime {
    start(name: string, request: {
      label?: string
      prompt: ContentBlock[]
      parent: Agent
      signal: AbortSignal
      agentOptions?: AgentOptions
      outputSchema?: Record<string, unknown>
      maxDepth?: number
      toolFilter?: { allow?: readonly string[]; deny?: readonly string[] }
      persona?: string
    }): Promise<SubagentRun>
  }
}

declare module '@deepseek-ai/dsh-tools' {
  import type { Agent } from '@deepseek-ai/dsh-agent'

  export interface ToolRuntime {
    register(definition: unknown): () => void
    schemas(scope?: Agent): Array<{ name: string; description: string; parameters: unknown }>
  }
  export type ObjectJsonSchema = { type: 'object'; [key: string]: unknown }
  export function defineTool(options: any): any
}
