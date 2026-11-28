import assert from "node:assert/strict";
import { test } from "node:test";

test("an unresolved site sheet delays capture and a failed packaged import leaves the page untouched", { timeout: 5000 }, async t => {
    const sent = [];
    const failure = Promise.withResolvers();
    let deliver;
    const port = {
        postMessage(message) {
            sent.push(message);
            if (message.event === "candidate-load-stage" && message.fields.asset === "candidate" && message.fields.result === "rejected") failure.resolve();
        },
        onMessage: { addListener: handler => { deliver = handler; } }, onDisconnect: { addListener() {} },
    };
    const win = new EventTarget();
    win.top = win;
    const doc = Object.assign(new EventTarget(), {
        readyState: "loading", hidden: false, styleSheets: [],
        querySelectorAll: selector => selector.startsWith("link") ? [{ sheet: null, disabled: false }] : [],
    });
    Object.assign(globalThis, {
        document: doc, window: win, location: new URL("http://localhost:8787/frame.html"),
        browser: { runtime: { connect: () => port, getURL: () => new URL("./absent-bundle.js", import.meta.url).href } },
        MutationObserver: class { observe() {} takeRecords() { return []; } },
        matchMedia: () => ({ matches: false, addListener() {} }),
    });
    t.mock.method(globalThis, "setInterval", () => 0);
    t.after(() => {
        for (const key of ["document", "window", "location", "browser", "MutationObserver", "matchMedia", "safariProbeObservations"]) {
            delete globalThis[key];
        }
    });
    await import("../extension/content.ts");
    const decision = { type: "decision", revision: 1, inputRevision: 1, enabled: true, privileged: true, fix: true, renderer: "candidate",
        appearance: { mode: "adaptive", theme: "graphite", brightness: 100, linkColor: "#123456" } };
    deliver(decision);
    doc.readyState = "interactive";
    doc.dispatchEvent(new Event("DOMContentLoaded"));
    assert.equal(sent.some(row => row.type === "report"), false);
    doc.readyState = "complete";
    win.dispatchEvent(new Event("load"));
    assert.ok(sent.some(row => row.event === "native-dark-read" && row.fields.reason === "unreadable"));
    deliver(decision);
    await failure.promise;
    assert.ok(sent.some(row => row.event === "ordinary-message" && row.fields.returned === "unavailable"));
    assert.ok(sent.some(row => row.event === "candidate-load-stage" && row.fields.stage === "evaluation" && row.fields.result === "unobserved"));
    assert.equal(sent.some(row => row.event === "candidate-enabled" || row.type === "read"), false);
});
