import assert from "node:assert/strict";
import { test } from "node:test";
import { FrameRenderer } from "../extension/renderer.ts";

test("the document port applies only current decisions, including while the packaged UMD loads", { timeout: 5000 }, async t => {
    const sent = [];
    const styles = new Set();
    const echoes = [];
    const imported = Promise.withResolvers();
    let deliver;
    let disconnect;
    const runtime = {
        connect({ name }) {
            assert.equal(name, "probe-document");
            const port = {
                onMessage: { addListener(handler) { deliver = handler; } },
                onDisconnect: { addListener(handler) { disconnect = handler; port.disconnect = handler; } },
                postMessage(message) { sent.push(message); },
            };
            return port;
        },
        getURL(path) {
            assert.equal(path, "darkreader.js");
            return new URL("../node_modules/darkreader/darkreader.js", import.meta.url).href;
        },
        sendMessage(message) {
            echoes.push(message);
            if (message.phase === "after-import") imported.resolve();
            return Promise.resolve({ ...message, instance: "test", receiverCount: 1 });
        },
    };
    const win = new EventTarget();
    win.chrome = { runtime };
    win.top = win.self = win;
    const generated = [];
    let scheme = "light";
    const siteSheet = { media: { mediaText: "" }, cssRules: [{ type: 1, selectorText: ":root",
        style: { getPropertyValue: () => scheme } }] };
    const doc = Object.assign(new EventTarget(), {
        readyState: "complete", hidden: false, styleSheets: [siteSheet],
        querySelectorAll: selector => selector === "style.darkreader" ? generated : [], querySelector: () => null,
        head: { append: node => styles.add(node) },
        createElement() {
            const node = { remove: () => styles.delete(node), style: { colorScheme: "" } };
            return node;
        },
    });
    let mutate;
    const globals = {
        location: new URL("http://127.0.0.1:8787/page.html"), document: doc, window: win, chrome: win.chrome,
        browser: { runtime }, matchMedia: () => ({ matches: false, addListener() {} }),
        MutationObserver: class { constructor(callback) { mutate = callback; } observe() {} takeRecords() { return []; } },
    };
    Object.assign(globalThis, globals);
    let poll;
    t.mock.method(globalThis, "setInterval", callback => { poll = callback; return 0; });
    t.after(() => {
        for (const key of [...Object.keys(globals), "DarkReader", "safariProbeObservations"]) delete globalThis[key];
    });
    // Capture the adapter at the public registration boundary. The UMD and its
    // ordinary-message shim still load from the exact package used by the build.
    let hook;
    const register = FrameRenderer.prototype.register;
    t.mock.method(FrameRenderer.prototype, "register", function(candidate) {
        const setFetch = candidate.setFetchMethod.bind(candidate);
        t.mock.method(candidate, "setFetchMethod", fetch => { hook = fetch; setFetch(fetch); });
        register.call(this, candidate);
    });
    await import("../extension/content.ts");
    const decision = (revision, overrides) => ({
        type: "decision", instance: "test", revision, reason: "active", enabled: true, privileged: false, fix: true,
        renderer: "marker", appearance: { mode: "adaptive", theme: "graphite", brightness: 100, linkColor: "#336699" },
        ...overrides,
    });
    const registration = sent.find(message => message.type === "hello").registration;
    assert.match(registration, /^[a-f0-9]{32}$/);
    assert.deepEqual(sent.find(message => message.type === "report"), {
        type: "report", nativeDark: "light", systemDark: false,
    });
    deliver(decision(1));
    assert.equal(styles.size, 1);
    deliver(decision(2, { enabled: false }));
    deliver(decision(1));
    assert.equal(styles.size, 0);

    deliver(decision(3, { renderer: "candidate" }));
    deliver(decision(4, { enabled: false }));
    await imported.promise;
    assert.deepEqual(echoes.map(message => message.phase), ["before-import", "after-import"]);
    assert.equal(globalThis.DarkReader.isEnabled(), false);
    assert.equal(sent.some(message => message.event === "candidate-enabled"), false);
    assert.ok(sent.some(message => message.event === "ordinary-reply" && message.fields.echoed));
    assert.ok(sent.some(message => message.event === "ordinary-message" &&
        message.fields.phase === "after-import" && message.fields.returned === "undefined"));
    // Test read/reply ordering independently of Safari's visual rendering.
    t.mock.method(globalThis.DarkReader, "enable", () => {});
    t.mock.method(globalThis.DarkReader, "disable", () => {});
    deliver(decision(5, { renderer: "candidate", privileged: true }));
    const url = "http://127.0.0.1:8788/css/opaque.css";
    const first = hook(url);
    const request = sent.filter(message => message.type === "read").at(-1);
    assert.deepEqual(request, { type: "read", revision: 5, id: request.id, url });
    deliver({ type: "read-result", revision: 6, id: request.id, ok: true, css: "wrong revision" });
    deliver({ type: "read-result", revision: 5, id: request.id, ok: true, css: "p {}" });
    assert.equal(await (await first).text(), "p {}");
    const second = hook(url);
    const nextRequest = sent.filter(message => message.type === "read").at(-1);
    deliver(decision(6));
    deliver({ type: "read-result", revision: 5, id: nextRequest.id, ok: true, css: "superseded" });
    await assert.rejects(second, /unavailable/);
    await assert.rejects(hook(url), /Unattributable/);
    assert.equal(sent.filter(message => message.type === "read").length, 2);
    assert.equal(styles.size, 1);
    scheme = "dark";
    poll();
    assert.equal(styles.size, 0);
    assert.equal(sent.filter(message => message.type === "report").at(-1).nativeDark, "dark");
    deliver(decision(7, { enabled: false }));
    generated.push({ sheet: { cssRules: [{ cssText: "p { color: red; }" }] } });
    poll();
    const late = sent.filter(message => message.event === "render-effects").at(-1);
    assert.equal(late.fields.eligible, false);
    assert.equal(late.fields.rules, 1);
    mutate([{ target: { nodeType: 1, closest: () => null }, attributeName: "data-darkreader-mode" }]);
    assert.equal(sent.filter(message => message.event === "candidate-dom-mutation").at(-1).fields.eligible, false);

    const oldDeliver = deliver;
    globalThis.location.hash = "next";
    win.dispatchEvent(new Event("hashchange"));
    assert.equal(sent.filter(message => message.type === "hello").length, 2);
    assert.equal(sent.filter(message => message.type === "hello").at(-1).registration, registration);
    oldDeliver(decision(100));
    assert.equal(styles.size, 0);
    deliver(decision(8));
    assert.equal(styles.size, 1);
    disconnect();
    assert.equal(styles.size, 0);
    deliver(decision(9));
    assert.equal(styles.size, 0);
    assert.ok(globalThis.safariProbeObservations().some(message => message.event === "document-disconnected"));
    win.dispatchEvent(new Event("focus"));
    deliver(decision(1));
    assert.equal(styles.size, 1);
    win.dispatchEvent(new Event("pagehide"));
    assert.equal(styles.size, 0);
    win.dispatchEvent(new Event("focus"));
    assert.equal(sent.filter(message => message.type === "hello").length, 3);
    win.dispatchEvent(new Event("pageshow"));
    doc.dispatchEvent(new Event("visibilitychange"));
    assert.equal(sent.filter(message => message.type === "hello").length, 4);
    assert.equal(sent.filter(message => message.type === "hello").at(-1).registration, registration);
    assert.equal(JSON.stringify(globalThis.safariProbeObservations()).includes(registration), false);
});
