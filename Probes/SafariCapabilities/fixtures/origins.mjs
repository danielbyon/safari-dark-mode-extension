/** Shared by the fixture server and extension build. Safari grants may group ports on one host. */
export const DEFAULT_ORIGINS = Object.freeze({
  top: "http://127.0.0.1:8787",
  frame: "http://localhost:8787",
  resource: "http://127.0.0.1:8788",
  denied: "http://localhost:8788",
});

export const RESOURCE_PATHS = Object.freeze([
  "/css/same.css", "/css/cors.css", "/css/opaque.css", "/css/import.css",
  "/css/imported.css", "/css/leaf.css", "/css/redirect.css", "/css/redirect-cross.css",
  "/css/target.css", "/css/failed.css", "/css/gated.css",
]);

/** Accept a partial role map or its JSON representation in SAFARI_PROBE_ORIGINS. */
export function parseOrigins(overrides = {}) {
  let input = overrides;
  if (typeof overrides === "string") {
    try { input = JSON.parse(overrides); }
    catch { throw new TypeError("SAFARI_PROBE_ORIGINS must contain a JSON object"); }
  }
  if (!input || Array.isArray(input) || typeof input !== "object") {
    throw new TypeError("Expected an object mapping fixture roles to origins");
  }
  const origins = { ...DEFAULT_ORIGINS };
  for (const [role, value] of Object.entries(input)) {
    if (!Object.hasOwn(origins, role) || typeof value !== "string") {
      throw new TypeError("Unknown fixture role or invalid origin");
    }
    let url;
    try { url = new URL(value); }
    catch { throw new TypeError(`Invalid fixture origin for ${role}`); }
    const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    const dnsName = url.hostname.split(".").every(label =>
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
    const allowed = (url.protocol === "http:" && loopback) ||
      (url.protocol === "https:" && !url.port && (loopback || dnsName));
    if (!allowed || url.username || url.password || url.href !== `${url.origin}/`) {
      throw new TypeError(`Expected a loopback HTTP or default-port HTTPS origin for ${role}`);
    }
    origins[role] = url.origin;
  }
  if (new Set(Object.values(origins).map(value => new URL(value).host)).size !== Object.keys(origins).length) {
    throw new TypeError("Each fixture role needs a distinct HTTP Host header");
  }
  return Object.freeze(origins);
}
