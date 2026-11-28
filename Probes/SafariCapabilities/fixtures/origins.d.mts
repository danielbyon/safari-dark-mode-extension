export type Origins = Readonly<Record<"top" | "frame" | "resource" | "denied", string>>;
export const DEFAULT_ORIGINS: Origins;
export const RESOURCE_PATHS: readonly string[];
export function parseOrigins(overrides?: unknown): Origins;
