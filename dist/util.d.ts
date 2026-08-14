import type { ContentBlock } from '@deepseek-ai/dsh-llm';
export declare class EvolutionError extends Error {
    readonly code: string;
    readonly details?: Record<string, unknown> | undefined;
    constructor(message: string, code: string, details?: Record<string, unknown> | undefined);
}
export declare class ConcurrentProfileChangeError extends EvolutionError {
    constructor(expected: string, actual: string);
}
export declare function nowIso(): string;
export declare function newId(prefix: string): string;
export declare function sha256(value: string | Uint8Array): string;
export declare function canonicalize(value: unknown): unknown;
export declare function canonicalJson(value: unknown): string;
export declare function pathExists(target: string): Promise<boolean>;
export declare function readJson<T>(file: string): Promise<T>;
export declare function writeJsonAtomic(file: string, value: unknown): Promise<void>;
export declare function writeFileAtomic(file: string, content: string | Uint8Array): Promise<void>;
export declare function normalizeRelative(input: string): string;
export declare function isPathWithin(parent: string, child: string): boolean;
export declare function resolveExistingDirectory(input: string): Promise<string>;
export declare function ensureNoSymlinkTraversal(root: string, relativePath: string): Promise<string>;
export declare function globToRegExp(glob: string): RegExp;
export declare function matchesAny(relativePath: string, patterns: readonly string[]): boolean;
export declare function listRegularFiles(root: string): Promise<string[]>;
export declare function abortableSleep(milliseconds: number, signal?: AbortSignal): Promise<void>;
export declare function assertNotAborted(signal?: AbortSignal): void;
export declare function mapPool<T, U>(values: readonly T[], concurrency: number, mapper: (value: T, index: number) => Promise<U>): Promise<U[]>;
export declare function round(value: number, digits?: number): number;
export declare function textFromContentBlocks(blocks: readonly ContentBlock[]): string;
export declare function redactError(error: unknown): string;
//# sourceMappingURL=util.d.ts.map