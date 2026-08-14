import type { ResolvedEvolutionConfig, SnapshotManifest } from './types.js';
export declare function snapshotDirectoryForVersion(snapshotsRoot: string, version: number): string;
export declare function verifySnapshot(snapshotDirectory: string): Promise<SnapshotManifest>;
export declare function captureSnapshot(profileDirectory: string, snapshotsRoot: string, version: number, config: Pick<ResolvedEvolutionConfig, 'managedFiles' | 'excludedFiles' | 'requiredFiles'>): Promise<{
    path: string;
    manifest: SnapshotManifest;
}>;
export declare function restoreSnapshot(snapshotDirectory: string, profileDirectory: string, expectedCurrentDigest: string, config: Pick<ResolvedEvolutionConfig, 'managedFiles' | 'excludedFiles' | 'requiredFiles'>): Promise<string>;
export declare function listSnapshotVersions(snapshotsRoot: string): Promise<number[]>;
//# sourceMappingURL=snapshot.d.ts.map