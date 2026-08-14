import type { BenchmarkManifest, LoadedBenchmark } from './types.js';
export declare function validateBenchmarkManifest(value: unknown): BenchmarkManifest;
export declare function loadBenchmark(benchmarkDirectory: string, options: {
    workspace?: string;
    allowInsideWorkspace: boolean;
}): Promise<LoadedBenchmark>;
//# sourceMappingURL=benchmark.d.ts.map