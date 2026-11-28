import { DEFAULT_ORIGINS, RESOURCE_PATHS, type Origins } from "../fixtures/origins.mjs";

declare const __PROBE_ORIGINS__: Origins;

/** Builds embed operator-selected fixture origins. Direct Node tests use loopback defaults. */
export const fixtureOrigins: Origins = Object.freeze(
    typeof __PROBE_ORIGINS__ === "undefined" ? DEFAULT_ORIGINS : __PROBE_ORIGINS__
);
export const resourcePaths = RESOURCE_PATHS;
