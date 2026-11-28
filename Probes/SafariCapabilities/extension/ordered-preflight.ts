import { fixtureOrigins } from "./fixture-config.ts";

// The manifest runs this file before content.js. This flag is its only effect.
// Match patterns ignore ports, so check the configured origin inside the script.
if ([fixtureOrigins.top, fixtureOrigins.frame, fixtureOrigins.denied].includes(location.origin)) {
    Object.defineProperty(globalThis, "safariProbeOrderedPreflight", {value: true});
}
