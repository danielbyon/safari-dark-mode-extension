import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createCandidateLoader } from "../extension/candidate-loader.ts";

const control = new URL("../extension/packaged-control.mjs", import.meta.url).href;
const apiModule = "globalThis.DarkReader = {enable() {}, disable() {}, isEnabled() {}, setFetchMethod() {}};";

async function harness(t, source, options = {}, controlSource) {
    const root = fileURLToPath(new URL("../.build/", import.meta.url));
    await mkdir(root, {recursive: true});
    const dir = await mkdtemp(join(root, "loader-test-"));
    const file = join(dir, "candidate.mjs");
    const localControl = join(dir, "control.mjs");
    if (controlSource) await writeFile(localControl, controlSource);
    const controlDone = Promise.withResolvers();
    if (source !== null) await writeFile(file, source);
    const rows = [], messages = [], registrations = [], requests = [];
    t.after(async () => {
        delete globalThis.DarkReader;
        delete globalThis.safariProbeTestGate;
        await rm(dir, {recursive: true, force: true});
    });
    const loader = createCandidateLoader({
        getURL(path) {
            requests.push(path);
            return path === "darkreader.js" ? pathToFileURL(file).href : (controlSource ? pathToFileURL(localControl).href : control);
        },
        getCandidate: () => globalThis.DarkReader,
        register: candidate => registrations.push(candidate),
        trace(event, fields) {
            assert.equal(event, "candidate-load-stage");
            rows.push(fields);
            if (fields.asset === "control" && (fields.stage === "world" ||
                fields.result === "unobserved" || fields.result === "threw")) controlDone.resolve();
        },
        ordinary: phase => messages.push(phase),
        ...options,
    });
    const observed = (asset, stage, result) => rows.some(row =>
        row.asset === asset && row.stage === stage && row.result === result);
    return {loader, rows, messages, registrations, requests, observed, controlDone: controlDone.promise};
}

test("same-world control and UMD each report their own stages", async t => {
    const {loader, rows, messages, registrations, requests, controlDone} = await harness(t, apiModule);
    assert.equal(await loader.load(9, () => false), false);
    assert.deepEqual(requests, []);
    const results = await Promise.all([loader.load(10, () => true), loader.load(11, () => true)]);
    assert.deepEqual(results, [true, true]);
    loader.afterDisable();
    assert.deepEqual(messages, ["before-import", "after-import", "after-disable"]);
    assert.deepEqual(requests, ["packaged-control.mjs", "darkreader.js"]);
    assert.deepEqual(registrations, [globalThis.DarkReader]);
    await controlDone;
    const stages = asset => rows.filter(row => row.asset === asset && row.stage !== "eligibility")
        .map(({stage, result}) => [stage, result]);
    assert.deepEqual(stages("control"), [
        ["url", "resolved"], ["import", "requested"], ["import", "resolved"], ["evaluation", "completed"], ["world", "present"],
    ]);
    assert.deepEqual(stages("candidate"), [
        ["url", "resolved"], ["import", "requested"], ["import", "resolved"], ["evaluation", "completed"],
        ["world", "present"], ["api", "available"], ["register", "registered"],
    ]);
});

test("a suspended control import does not block candidate measurement", {timeout: 3000}, async t => {
    const release = Promise.withResolvers();
    globalThis.safariProbeTestGate = { wait: release.promise };
    const {loader, observed, controlDone} = await harness(t, apiModule, {},
        "await globalThis.safariProbeTestGate.wait; export const controlWorld = globalThis;");
    try {
        assert.equal(await loader.load(1, () => true), true);
        assert.ok(observed("control", "import", "requested"));
        assert.equal(observed("control", "evaluation", "completed"), false);
        assert.ok(observed("candidate", "register", "registered"));
    } finally {
        release.resolve();
        await controlDone;
    }
});

test("an in-flight import records evaluation but waits for a current decision to register", async t => {
    const started = Promise.withResolvers(), release = Promise.withResolvers();
    globalThis.safariProbeTestGate = {started: started.resolve, wait: release.promise};
    const {loader, registrations, observed} = await harness(t,
        `globalThis.safariProbeTestGate.started(); await globalThis.safariProbeTestGate.wait; ${apiModule}`);
    let eligible = true;
    const result = loader.load(1, () => eligible);
    await started.promise;
    eligible = false;
    release.resolve();
    assert.equal(await result, false);
    assert.ok(observed("candidate", "evaluation", "completed"));
    assert.deepEqual(registrations, []);
    assert.equal(await loader.load(2, () => true), true);
    assert.equal(registrations.length, 1);
});

test("URL failures and native import rejections expose fixed classifications", async t => {
    const {loader, rows, observed, controlDone} = await harness(t, null, {getURL(path) {
        if (path === "darkreader.js") throw new TypeError("private-extension-identifier");
        return new URL("./absent-positive-control.mjs", import.meta.url).href;
    }});
    assert.equal(await loader.load(3, () => true), false);
    await controlDone;
    assert.ok(observed("control", "import", "rejected"));
    assert.ok(observed("control", "evaluation", "unobserved"));
    assert.ok(observed("candidate", "url", "threw"));
    assert.equal(rows.find(row => row.asset === "candidate" && row.stage === "url").errorClass, "TypeError");
    assert.doesNotMatch(JSON.stringify(rows), /private-extension|file:|positive-control/);
});

for (const [label, source, stage, outcome, after] of [
    ["missing bytes", null, "evaluation", "unobserved", false],
    ["an unobserved evaluation exception", 'throw new Error("private");', "evaluation", "unobserved", false],
    ["exception after UMD world assignment", 'globalThis.DarkReader = {}; throw new ReferenceError("private");', "evaluation", "started", true],
    ["no UMD global", "export const enabled = true;", "world", "missing", true],
    ["partial public API", "globalThis.DarkReader = {enable() {}, disable() {}};", "api", "incomplete", true],
]) {
    test(`diagnoses ${label} without classifying ambiguous import rejections`, async t => {
        const {loader, rows, observed, messages, registrations, controlDone} = await harness(t, source);
        assert.equal(await loader.load(4, () => true), false);
        await controlDone;
        assert.ok(observed("control", "world", "present"));
        assert.ok(observed("candidate", stage, outcome));
        assert.equal(messages.includes("after-import"), after);
        assert.deepEqual(registrations, []);
        assert.doesNotMatch(JSON.stringify(rows), /private|file:|candidate\.mjs/);
    });
}

test("a preexisting global cannot prove that this UMD registered", async t => {
    const {loader, observed} = await harness(t, apiModule);
    globalThis.DarkReader = {};
    assert.equal(await loader.load(5, () => true), false);
    assert.ok(observed("candidate", "world", "preexisting"));
    assert.equal(observed("candidate", "import", "requested"), false);
});

test("failed adapter registration remains distinct from API availability", async t => {
    let attempts = 0;
    const {loader, rows, observed} = await harness(t, apiModule, {register() {
        attempts++;
        throw new DOMException("private", "SecurityError");
    }});
    assert.equal(await loader.load(6, () => true), false);
    assert.equal(await loader.load(7, () => true), false);
    assert.ok(observed("candidate", "api", "available"));
    assert.equal(rows.find(row => row.asset === "candidate" && row.stage === "register").errorClass, "SecurityError");
    assert.ok(observed("candidate", "register", "threw"));
    assert.equal(attempts, 1);
});
