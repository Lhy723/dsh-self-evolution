import type { EvolutionRunRecord, ProfileState, ResolvedEvolutionConfig, Scoreboard } from './types.js';
export interface ProfileStoragePaths {
    key: string;
    root: string;
    state: string;
    lock: string;
    snapshots: string;
    scoreboards: string;
    runs: string;
}
export declare function profileStoragePaths(config: Pick<ResolvedEvolutionConfig, 'stateRoot'>, profilePath: string): ProfileStoragePaths;
export declare class ProfileLock {
    private readonly file;
    private readonly token;
    private released;
    constructor(file: string, token: string);
    release(): Promise<void>;
}
export declare function acquireProfileLock(paths: ProfileStoragePaths, config: Pick<ResolvedEvolutionConfig, 'lockStaleMs'>, signal?: AbortSignal): Promise<ProfileLock>;
export declare function loadProfileState(paths: ProfileStoragePaths): Promise<ProfileState | undefined>;
export declare function saveProfileState(paths: ProfileStoragePaths, state: ProfileState): Promise<void>;
export declare function scoreboardPath(paths: ProfileStoragePaths, benchmarkId: string): string;
export declare function loadScoreboard(paths: ProfileStoragePaths, benchmarkId: string, benchmarkDigest: string): Promise<Scoreboard>;
export declare function saveScoreboard(paths: ProfileStoragePaths, scoreboard: Scoreboard): Promise<string>;
export interface RunStorage {
    runId: string;
    directory: string;
    recordFile: string;
    eventsFile: string;
    publicDirectory: string;
    privateDirectory: string;
}
export declare function createRunStorage(paths: ProfileStoragePaths, mode: EvolutionRunRecord['mode']): Promise<RunStorage>;
export declare function saveRunRecord(storage: RunStorage, record: EvolutionRunRecord): Promise<void>;
export declare function appendRunEvent(storage: RunStorage, type: string, data: Record<string, unknown>): Promise<void>;
export declare function writePublicArtifact(storage: RunStorage, relativePath: string, value: unknown): Promise<string>;
export declare function writePrivateArtifact(storage: RunStorage, relativePath: string, value: unknown): Promise<string>;
export declare function latestRunId(paths: ProfileStoragePaths): Promise<string | undefined>;
export declare function writeTextArtifact(file: string, content: string): Promise<void>;
//# sourceMappingURL=storage.d.ts.map