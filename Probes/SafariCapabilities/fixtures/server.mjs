import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { parseOrigins, RESOURCE_PATHS } from "./origins.mjs";

/**
 * Start with /page.html?sheet=opaque. Add frames=1, frameSheet=opaque, theme=dark,
 * wp=1 or csp=strict for the corresponding controls. The app records actions in the page.
 * On the top origin, POST /control/arm or /control/arm-mutation with Content-Type
 * application/json. GET /control/status reports waiting readers. POST /control/release
 * or /control/release-mutation to finish the selected response. Restart for fresh counts.
 */

const asset = (name) => readFileSync(new URL(name, import.meta.url), "utf8");
const pages = { page: asset("page.html"), frame: asset("frame.html") };
const script = asset("page.js");
const site = asset("site.css");
const resource = asset("resource.css");
const themes = {
  "/theme-a.css": ":root { color-scheme: light; background-color: #fafafa; color: #182332; }",
  "/theme-b.css": ":root { color-scheme: dark; background-color: #182332; color: #fafafa; }",
};

function renderPage(url, origins, origin, frame) {
  const params = url.searchParams;
  const sheet = params.get("sheet");
  const remote = sheet === "guard" ? origins.frame : origins.resource;
  const resourceURL = sheet === "same" ? `${origin}/css/same.css` :
    sheet === "guard" ? `${remote}/css/opaque.css` :
    RESOURCE_PATHS.includes(`/css/${sheet}.css`) ? `${remote}/css/${sheet}.css` : null;
  const resourceLink = resourceURL ?
    `<link id="resource-link" rel="stylesheet" href="${resourceURL}"${sheet === "cors" ? ' crossorigin="anonymous"' : ""}>` : "";
  const dark = params.get("theme") === "dark";
  const system = params.get("theme") === "system";
  const lightMedia = system ? "(prefers-color-scheme: light)" : dark ? "not all" : "all";
  const darkMedia = system ? "(prefers-color-scheme: dark)" : dark ? "all" : "not all";
  const frameTheme = params.get("frameTheme") === "dark" ? "dark" : "light";
  const crossOrigin = origin === origins.frame ? origins.top : origins.frame;
  const frameSheet = params.get("frameSheet");
  const childParams = new URLSearchParams({ theme: frameTheme });
  if (frameSheet === "guard" || RESOURCE_PATHS.includes(`/css/${frameSheet}.css`)) {
    childParams.set("sheet", frameSheet);
    childParams.set("frameSheet", frameSheet);
  }
  if (params.get("csp") === "strict") childParams.set("csp", "strict");
  const source = (base) => `${base}/frame.html?${childParams.toString().replaceAll("&", "&amp;")}`;
  let frames = "";
  if (!frame && params.get("frames") === "1") {
    frames = `<iframe title="Same-origin frame" src="${source(origin)}&amp;nested=1&amp;frameTheme=${frameTheme}"></iframe>
      <iframe title="Cross-origin frame" src="${source(crossOrigin)}"></iframe>`;
  } else if (frame && params.get("nested") === "1") {
    frames = `<iframe title="Nested cross-origin frame" src="${source(crossOrigin)}"></iframe>`;
  }
  return pages[frame ? "frame" : "page"].replaceAll("{{lightMedia}}", lightMedia)
    .replaceAll("{{darkMedia}}", darkMedia).replaceAll("{{crossOrigin}}", crossOrigin)
    .replace("<!-- resource-link -->", resourceLink).replace("<!-- frames -->", frames)
    .replace('<html lang="en">', params.get("wp") === "1" ?
      '<html lang="en" data-wp-dark-mode-preset="1">' : '<html lang="en">');
}

/**
 * A style destination identifies a stylesheet load. Use the extension-off baseline and loader
 * trace to attribute it. Safari may omit Origin on fetches, which leaves the requester unknown.
 */
function requestClass(headers, origins) {
  const origin = headers.origin;
  if (typeof origin === "string" && /^safari-web-extension:\/\/[^/?#\s]+$/i.test(origin)) {
    return "extension-origin";
  }
  if (headers["sec-fetch-dest"] === "style") return "style-load";
  if (Object.values(origins).includes(origin)) return "fixture-origin";
  return "unknown";
}

/** Coordinates one operator run. A disconnected client is removed before the next release. */
function createGate() {
  const waiting = new Map();
  let armed = false;
  let interrupted = 0;
  let released = 0;
  return {
    arm() { armed = true; },
    state() { return { armed, waiting: waiting.size, interrupted, released }; },
    hold(response, body) {
      if (!armed) { response.end(body); return; }
      waiting.set(response, body);
      response.once("close", () => {
        if (waiting.delete(response)) interrupted++;
      });
    },
    release() {
      armed = false;
      for (const [response, body] of waiting) {
        waiting.delete(response);
        response.end(body);
        released++;
      }
    },
  };
}

/**
 * All listeners for a run share this handler. Only known stylesheet requests increment counters.
 * Page visits, query strings, referrers, extension IDs and request bodies stay out of the record.
 */
export function createFixtureHandler(overrides) {
  const origins = parseOrigins(overrides);
  const cssGate = createGate();
  const mutationGate = createGate();
  const counts = new Map();
  const send = (response, status, type, body) => {
    response.writeHead(status, { "Content-Type": type });
    response.end(body);
  };
  return (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");
    const role = Object.keys(origins).find(key => new URL(origins[key]).host === request.headers.host);
    if (!role || !request.url?.startsWith("/") || request.url.startsWith("//")) {
      return send(response, 400, "text/plain", "Unknown fixture origin");
    }
    const origin = origins[role];
    let url;
    try { url = new URL(request.url, origin); }
    catch { return send(response, 400, "text/plain", "Invalid request"); }
    if (url.origin !== origin) return send(response, 400, "text/plain", "Invalid request origin");
    const path = url.pathname;
    if (path.startsWith("/control/")) {
      // Gate changes require a same-origin operator or a local CLI with an explicit JSON content type.
      if (role !== "top" || (request.headers.origin && request.headers.origin !== origin) ||
          request.headers["sec-fetch-site"] === "cross-site") {
        return send(response, 403, "text/plain", "Use the top fixture origin");
      }
      if (path === "/control/status" && request.method === "GET") {
        return send(response, 200, "application/json", JSON.stringify({
          css: cssGate.state(), mutation: mutationGate.state(), counts: Object.fromEntries(counts),
        }));
      }
      if (path === "/control/mutation" && request.method === "GET") {
        response.setHeader("Content-Type", "text/plain");
        mutationGate.hold(response, "released");
        return;
      }
      if (request.method !== "POST" || request.headers["content-type"] !== "application/json") {
        return send(response, 405, "text/plain", "POST with Content-Type application/json");
      }
      switch (path) {
        case "/control/arm": cssGate.arm(); break;
        case "/control/release": cssGate.release(); break;
        case "/control/arm-mutation": mutationGate.arm(); break;
        case "/control/release-mutation": mutationGate.release(); break;
        default: return send(response, 404, "text/plain", "Unknown control");
      }
      return send(response, 200, "application/json", '{"ok":true}');
    }
    if (request.method !== "GET") return send(response, 405, "text/plain", "GET required");
    if (RESOURCE_PATHS.includes(path)) {
      const kind = requestClass(request.headers, origins);
      const key = `${role}:${path.slice(5, -4)}:${kind}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (path === "/css/failed.css") return send(response, 404, "text/plain", "Missing fixture sheet");
      if (path === "/css/cors.css") response.setHeader("Access-Control-Allow-Origin", "*");
      if (path === "/css/redirect.css" || path === "/css/redirect-cross.css") {
        const target = path === "/css/redirect.css" ? origins.resource : origins.denied;
        response.setHeader("Location", `${target}/css/target.css`);
        return send(response, 302, "text/plain", "");
      }
      if (path === "/css/import.css" || path === "/css/imported.css") {
        const target = path === "/css/import.css" ? `${origins.denied}/css/imported.css` :
          `${origins.resource}/css/leaf.css`;
        return send(response, 200, "text/css", `@import url("${target}");\n`);
      }
      if (path === "/css/gated.css" && kind !== "style-load") {
        response.writeHead(200, { "Content-Type": "text/css" });
        response.write("/* awaiting fixture release */\n");
        cssGate.hold(response, resource);
        return;
      }
      return send(response, 200, "text/css", resource);
    }
    if (url.searchParams.get("csp") === "strict") {
      const hosts = Object.values(origins).join(" ");
      response.setHeader("Content-Security-Policy",
        `default-src 'none'; script-src 'self'; style-src 'self' ${hosts}; frame-src 'self' ${hosts}; connect-src 'self' ${hosts}; base-uri 'none'; form-action 'none'`);
    }
    if (Object.hasOwn(themes, path)) return send(response, 200, "text/css", themes[path]);
    if (path === "/site.css") return send(response, 200, "text/css", site);
    if (path === "/site-update.css") return send(response, 200, "text/css", `${site}\n.dynamic-sample { border-bottom: 2px solid currentColor; }`);
    if (path === "/page.js") return send(response, 200, "text/javascript", script);
    if (path === "/frame.html" || ["/", "/page.html", "/next/page.html", "/private/page.html"].includes(path)) {
      return send(response, 200, "text/html; charset=utf-8", renderPage(url, origins, origin, path === "/frame.html"));
    }
    return send(response, 404, "text/plain", "Unknown fixture");
  };
}

if (import.meta.main) {
  const origins = parseOrigins(process.env.SAFARI_PROBE_ORIGINS);
  const handler = createFixtureHandler(origins);
  // An existing HTTPS proxy must preserve Host and forward to one of these loopback ports.
  const listeners = new Set();
  const ready = [];
  const localOrigins = Object.values(origins).filter(raw => new URL(raw).protocol === "http:");
  for (const raw of localOrigins.length ? localOrigins : ["http://127.0.0.1:8787"]) {
    const url = new URL(raw);
    if (url.protocol !== "http:") continue;
    const port = Number(url.port || 80);
    const addresses = url.hostname === "localhost" ? ["127.0.0.1", "::1"] :
      [url.hostname === "[::1]" ? "::1" : "127.0.0.1"];
    for (const address of addresses) {
      const key = `${address}:${port}`;
      if (listeners.has(key)) continue;
      listeners.add(key);
      const server = createServer(handler);
      ready.push(new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, address, resolve);
      }));
    }
  }
  try {
    await Promise.all(ready);
    console.log("Fixture server ready. Open /page.html on the configured top origin.");
  } catch (error) {
    console.error(`Fixture listener failed at ${error.address}:${error.port} (${error.code}).`);
    process.exit(1);
  }
}
