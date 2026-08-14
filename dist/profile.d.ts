import type { AgentOptions } from '@deepseek-ai/dsh-agent';
import type { LoadedProfile, ProfileRuntime, ResolvedEvolutionConfig } from './types.js';
export declare function validateRuntime(value: unknown, source?: string): ProfileRuntime;
export declare function enumerateManagedFiles(profileDirectory: string, config: Pick<ResolvedEvolutionConfig, 'managedFiles' | 'excludedFiles' | 'requiredFiles'>): Promise<string[]>;
export declare function profileFileInventory(profileDirectory: string, config: Pick<ResolvedEvolutionConfig, 'managedFiles' | 'excludedFiles' | 'requiredFiles'>): Promise<Array<{
    path: string;
    sha256: string;
    size: number;
}>>;
export declare function digestInventory(files: Array<{
    path: string;
    sha256: string;
    size: number;
}>): string;
export declare function computeProfileDigest(profileDirectory: string, config: Pick<ResolvedEvolutionConfig, 'managedFiles' | 'excludedFiles' | 'requiredFiles'>): Promise<string>;
export declare function loadProfile(profileDirectory: string, config: Pick<ResolvedEvolutionConfig, 'managedFiles' | 'excludedFiles' | 'requiredFiles'>): Promise<LoadedProfile>;
export declare function mergeAgentOptions(...options: Array<AgentOptions | undefined>): AgentOptions | undefined;
export declare function composeTargetPersona(profile: LoadedProfile): string;
export declare function profileAsPublicText(profile: LoadedProfile, maxBytes?: number): string;
export declare function setRuntimeVersion(profileDirectory: string, version: number): Promise<void>;
//# sourceMappingURL=profile.d.ts.map