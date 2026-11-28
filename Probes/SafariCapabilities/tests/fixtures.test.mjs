import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer, request } from "node:http";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { DEFAULT_ORIGINS, parseOrigins, RESOURCE_PATHS } from "../fixtures/origins.mjs";
import { createFixtureHandler } from "../fixtures/server.mjs";

// Each test gets fresh counters and gates. The Host header models a local reverse proxy.
async function fixture(t, overrides = {}) {
  const origins = parseOrigins(overrides);
  const server = createServer(createFixtureHandler(origins));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  const open = (role, path, headers = {}, method = "GET") => new Promise((resolve, reject) => {
    const req = request({
      hostname: "127.0.0.1", port: server.address().port, path, method,
      headers: { Host: new URL(origins[role]).host, ...headers },
    }, resolve);
    req.on("error", reject);
    req.end();
  });
  const read = async (...args) => {
    const response = await open(...args);
    let body = "";
    for await (const chunk of response) body += chunk;
    return { status: response.statusCode, headers: response.headers, body };
  };
  const control = path => read("top", `/control/${path}`, { "Content-Type": "application/json" }, "POST");
  const status = async () => JSON.parse((await read("top", "/control/status")).body);
  return { origins, open, read, control, status };
}

test("configuration accepts an existing HTTPS origin without changing the loopback defaults", () => {
  const configured = parseOrigins('{"resource":"https://sheets.example.test:443/"}');
  assert.equal(configured.resource, "https://sheets.example.test");
  assert.deepEqual(parseOrigins(), DEFAULT_ORIGINS);
  assert.equal(configured.top, DEFAULT_ORIGINS.top);
  for (const bad of [
    [], null, { extra: "http://localhost" }, { resource: "https://a.test/path" },
    { resource: "https://a.test:444" }, { resource: "http://a.test" },
    { resource: "https://user:pass@a.test" }, { resource: DEFAULT_ORIGINS.frame },
    { resource: "https://a.test/#" }, { resource: "https://a.test/?" },
    { resource: "https://*.example.test" }, { resource: "https://host;foo.test" },
  ]) assert.throws(() => parseOrigins(bad));
  for (const bad of ['private-sentinel', { resource: "private-sentinel" }]) {
    assert.throws(() => parseOrigins(bad), error => !String(error).includes("private-sentinel"));
  }
});

test("CLI reports readiness after all overridden ports listen and fails cleanly on a collision", { timeout: 8000 }, async t => {
  const reserve = async () => {
    const socket = createServer();
    socket.listen(0, "127.0.0.1");
    await once(socket, "listening");
    return socket;
  };
  const reserved = await Promise.all([reserve(), reserve()]);
  const [a, b] = reserved.map(server => server.address().port);
  await Promise.all(reserved.map(server => new Promise(resolve => server.close(resolve))));
  const origins = {
    top: `http://127.0.0.1:${a}`, frame: `http://localhost:${a}`,
    resource: `http://127.0.0.1:${b}`, denied: `http://localhost:${b}`,
  };
  const start = () => {
    const child = spawn(process.execPath, [fileURLToPath(new URL("../fixtures/server.mjs", import.meta.url))], {
      env: { ...process.env, SAFARI_PROBE_ORIGINS: JSON.stringify(origins) }, stdio: ["ignore", "pipe", "pipe"],
    });
    const exited = once(child, "exit");
    t.after(async () => { child.kill(); await exited; });
    return { child, exited };
  };
  const { child, exited } = start();
  const ready = await Promise.race([
    once(child.stdout, "data").then(([line]) => String(line)),
    exited.then(() => { throw new Error("Exited before listening"); }),
  ]);
  assert.match(ready, /ready/);
  for (const origin of Object.values(origins)) {
    const result = await fetch(`${origin}/page.html`);
    assert.equal(result.status, 200);
    await result.body.cancel();
  }
  const collision = start();
  let out = "", err = "";
  collision.child.stdout.on("data", chunk => { out += chunk; });
  collision.child.stderr.on("data", chunk => { err += chunk; });
  const [code] = await collision.exited;
  assert.equal(code, 1);
  assert.doesNotMatch(out, /ready/);
  assert.match(err, /EADDRINUSE/);
});

test("page and frame HTML select fixed hosts, strict CSP, CSS-only modes and a WP preset", async t => {
  const { read, origins } = await fixture(t, { resource: "https://sheets.example.test" });
  const result = await read("top", "/page.html?sheet=opaque&frames=1&frameTheme=dark&theme=dark&wp=1&csp=strict");
  assert.equal(result.status, 200);
  assert.ok(result.body.includes(`href="${origins.resource}/css/opaque.css"`));
  assert.ok(!result.body.includes("crossorigin="));
  assert.ok(result.body.includes(`${origins.frame}/frame.html?theme=dark`));
  assert.ok(result.body.includes(`${origins.top}/frame.html?theme=dark&amp;csp=strict&amp;nested=1`));
  assert.match(result.body, /id="sheet-b" media="all"/);
  assert.match(result.body, /data-wp-dark-mode-preset="1"/);
  assert.equal(result.body.includes("{{"), false);
  assert.ok(result.body.indexOf('src="/page.js"') < result.body.indexOf('href="/site.css"'));
  assert.match(result.headers["content-security-policy"], /script-src 'self';/);
  assert.doesNotMatch(result.headers["content-security-policy"], /unsafe-inline/);
  const nested = await read("frame", "/frame.html?nested=1&theme=system");
  assert.ok(nested.body.includes(`src="${origins.top}/frame.html?theme=light"`));
  assert.match(nested.body, /prefers-color-scheme: dark/);
  const withSheets = await read("top", "/page.html?frames=1&frameSheet=opaque");
  assert.match(withSheets.body, /frame\.html\?theme=light&amp;sheet=opaque&amp;frameSheet=opaque/);
  const clean = await read("top", "/private/page.html?sheet=unknown");
  assert.doesNotMatch(clean.body, /id="resource-link"|<iframe|data-wp-dark-mode-preset/);
  assert.equal(clean.headers["content-security-policy"], undefined);
  assert.equal(clean.headers["referrer-policy"], "no-referrer");
  assert.equal(clean.headers["cache-control"], "no-store");
  assert.equal(clean.headers["set-cookie"], undefined);
});

test("CORS, local guard and original stylesheet controls share a distinctive rule", async t => {
  const { read, origins } = await fixture(t);
  const cors = await read("resource", "/css/cors.css");
  const opaque = await read("resource", "/css/opaque.css");
  assert.equal(cors.headers["access-control-allow-origin"], "*");
  assert.equal(opaque.headers["access-control-allow-origin"], undefined);
  assert.equal(opaque.body, cors.body);
  assert.match(opaque.body, /#resource-swatch/);
  for (const [mode, origin, path] of [
    ["same", origins.top, "same"], ["cors", origins.resource, "cors"], ["guard", origins.frame, "opaque"],
  ]) {
    const { body } = await read("top", `/page.html?sheet=${mode}`);
    assert.ok(body.includes(`href="${origin}/css/${path}.css"`));
    assert.equal(body.includes('crossorigin="anonymous"'), mode === "cors");
  }
  assert.equal((await read("resource", "/css/failed.css")).status, 404);
  for (const path of RESOURCE_PATHS) {
    const { status } = await read("resource", path);
    assert.equal(status, path === "/css/failed.css" ? 404 : path.startsWith("/css/redirect") ? 302 : 200, path);
  }
});

test("nested imports and redirects name the exact resource and denied endpoints", async t => {
  const { read, status, origins } = await fixture(t);
  const first = await read("resource", "/css/import.css");
  assert.equal(first.body, `@import url("${origins.denied}/css/imported.css");\n`);
  const nested = await read("denied", "/css/imported.css");
  assert.equal(nested.body, `@import url("${origins.resource}/css/leaf.css");\n`);
  assert.match((await read("resource", "/css/leaf.css")).body, /7px solid/);
  for (const [route, target] of [["redirect", "resource"], ["redirect-cross", "denied"]]) {
    const response = await read("resource", `/css/${route}.css`);
    assert.equal(response.status, 302);
    assert.equal(response.headers.location, `${origins[target]}/css/target.css`);
  }
  assert.ok(Object.keys((await status()).counts).every(key => !key.includes(":target:")));
});

test("resource evidence keeps missing attribution and discards private request data", async t => {
  const { read, status, origins } = await fixture(t);
  await read("top", "/private/page.html?step=private-sentinel");
  const sensitive = { Cookie: "sid=private-sentinel", Referer: "https://private-sentinel.test/visit" };
  for (const headers of [
    { "Sec-Fetch-Dest": "style" }, { Origin: origins.top }, {},
    { Origin: "safari-web-extension://private-sentinel" },
    { Origin: "https://private-sentinel.test" },
  ]) await read("resource", "/css/opaque.css?private-sentinel", { ...sensitive, ...headers });
  const result = await status();
  assert.deepEqual(result.counts, {
    "resource:opaque:style-load": 1, "resource:opaque:fixture-origin": 1,
    "resource:opaque:unknown": 2, "resource:opaque:extension-origin": 1,
  });
  assert.doesNotMatch(JSON.stringify(result), /private-sentinel|https?:|safari-web-extension:/);
});

test("CSS gate holds a partial response, serves the site's sheet and tracks a disconnected reader", { timeout: 5000 }, async t => {
  const { read, open, control, status } = await fixture(t);
  assert.equal((await control("arm")).status, 200);
  const waiting = await open("resource", "/css/gated.css");
  assert.equal((await status()).css.waiting, 1);
  const native = await read("resource", "/css/gated.css", { "Sec-Fetch-Dest": "style" });
  assert.match(native.body, /#resource-swatch/);
  const interrupted = await open("resource", "/css/gated.css");
  interrupted.destroy();
  while (!(await status()).css.interrupted) await setImmediate();
  assert.equal((await status()).css.waiting, 1);
  await control("release");
  let body = "";
  for await (const chunk of waiting) body += chunk;
  assert.match(body, /awaiting fixture release[\s\S]+#resource-swatch/);
  assert.deepEqual((await status()).css, { armed: false, waiting: 0, released: 1, interrupted: 1 });
  assert.equal((await status()).mutation.released, 0);
});

test("a mutation release is independent of CSS and requires a top-origin operator", { timeout: 5000 }, async t => {
  const { read, control, status } = await fixture(t);
  await control("arm-mutation");
  const completion = read("top", "/control/mutation");
  while (!(await status()).mutation.waiting) await setImmediate();
  assert.equal((await read("frame", "/control/release-mutation", { "Content-Type": "application/json" }, "POST")).status, 403);
  assert.equal((await read("top", "/control/release-mutation", { Origin: "https://other.test" }, "POST")).status, 403);
  assert.equal((await read("top", "/control/release-mutation", {}, "POST")).status, 405);
  await control("release");
  assert.equal((await status()).mutation.waiting, 1);
  await control("release-mutation");
  assert.equal((await completion).body, "released");
  assert.equal((await status()).mutation.released, 1);
  assert.equal((await read("top", "/page.html", { Host: "unrelated.test" })).status, 400);
});
