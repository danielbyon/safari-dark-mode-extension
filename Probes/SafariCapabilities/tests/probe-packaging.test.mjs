import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createContext, runInContext, runInNewContext } from "node:vm";
import { build } from "esbuild";
import { DEFAULT_ORIGINS } from "../fixtures/origins.mjs";
import { auditedFiles, stageExtensions } from "../scripts/build.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const verify = promisify(execFile);
const readJSON = async path => JSON.parse(await readFile(path, "utf8"));

// Exercise the actual staged entry points. The ordered loader alone cannot catch a
// content bundle that still takes the old direct-import path.
async function checkOrderedContent(directory, scripts) {
    const sent = [], requested = [];
    let deliver;
    const port = {postMessage: message => sent.push(message), onDisconnect: {addListener() {}},
        onMessage: {addListener: handler => { deliver = handler; }}};
    const win = new EventTarget();
    win.top = win;
    const doc = Object.assign(new EventTarget(), {readyState: "complete", styleSheets: [],
        querySelector: () => null, querySelectorAll: () => []});
    const realm = createContext({window: win, document: doc, location: new URL(`${DEFAULT_ORIGINS.top}/page.html`),
        crypto, performance, AbortController, setInterval() {}, MutationObserver: class {observe() {} takeRecords() {return [];}},
        matchMedia: () => ({matches: false, addListener() {}}),
        browser: {runtime: {connect: () => port, getURL: name => {requested.push(name); return "";}}},
    });
    for (const script of scripts) runInContext(await readFile(join(directory, script), "utf8"), realm);
    const inputRevision = sent.findLast(message => message.type === "report").inputRevision;
    deliver({type: "decision", revision: 1, inputRevision, enabled: true, privileged: true, renderer: "candidate"});
    assert.deepEqual(requested, []);
    assert.ok(sent.some(row => row.event === "candidate-load-stage" && row.fields.result === "blocked-eager-umd"));
    assert.ok(sent.some(row => row.event === "candidate-load-stage" &&
        row.fields.stage === "ordered-preflight" && row.fields.result === "present"));
}

test("ordered manifests run an origin-checked preflight, and each variant retains the audited UMD", async t => {
    const buildRoot = join(root, ".build");
    await mkdir(buildRoot, {recursive: true});
    const outputRoot = await mkdtemp(join(buildRoot, "packaging-test-"));
    t.after(() => rm(outputRoot, {recursive: true, force: true}));
    for (const mode of ["dynamic", "ordered-preflight"]) {
        await stageExtensions({mode, origins: DEFAULT_ORIGINS, outputRoot});
    }
    const digests = new Set();
    for (const version of [2, 3]) {
        const base = await readJSON(join(root, `extension/manifest-v${version}.json`));
        let dynamic;
        for (const ordered of [false, true]) {
            const variant = `mv${version}${ordered ? "-ordered-preflight" : ""}`;
            const staged = join(outputRoot, variant), packaged = join(staged, "extension");
            const manifest = await readJSON(join(packaged, "manifest.json"));
            const receipt = await readJSON(join(staged, "resources.sha256.json"));
            assert.equal(receipt.files["darkreader.js"], auditedFiles["darkreader.js"]);
            assert.equal(receipt.files["DarkReader-LICENSE.txt"], auditedFiles.LICENSE);
            assert.equal(receipt.variant, variant);
            digests.add(receipt.sha256);
            assert.deepEqual(manifest.content_scripts[0].matches, base.content_scripts[0].matches);
            assert.deepEqual(manifest.content_scripts[0].js, ordered ? ["ordered-preflight.js", "content.js"] : ["content.js"]);
            assert.equal(manifest.content_scripts[0].world, undefined);
            assert.equal(manifest.web_accessible_resources, undefined);
            if (!ordered) dynamic = manifest;
            else {
                assert.deepEqual(manifest.permissions, dynamic.permissions);
                assert.deepEqual(manifest.host_permissions, dynamic.host_permissions);
                await checkOrderedContent(packaged, manifest.content_scripts[0].js);
                const source = await readFile(join(packaged, "ordered-preflight.js"), "utf8");
                for (const [origin, expected] of [[DEFAULT_ORIGINS.top, true], [DEFAULT_ORIGINS.resource, undefined],
                    ["http://127.0.0.1:9999", undefined]]) {
                    const world = {location: {origin}};
                    runInNewContext(source, world);
                    assert.equal(world.safariProbeOrderedPreflight, expected);
                    assert.equal(world.DarkReader, undefined);
                }
            }
            const args = [join(root, "scripts/verify-wrapper.mjs"), variant, staged, packaged];
            await verify(process.execPath, args);
            await writeFile(join(packaged, "packaged-control.mjs"), "changed");
            await assert.rejects(verify(process.execPath, args), /Packaged bytes differ for packaged-control.mjs/);
        }
    }
    assert.equal(digests.size, 4);
});

test("the ordered loader observes preflight without requesting, registering or enabling a UMD", async () => {
    const bundle = await build({absWorkingDir: root, entryPoints: ["extension/candidate-loader.ts"],
        bundle: true, write: false, format: "iife", globalName: "diagnostics",
        define: {__PROBE_LOADER_MODE__: JSON.stringify("ordered-preflight")}});
    for (const preflight of [true, false]) {
        const world = {safariProbeOrderedPreflight: preflight};
        runInNewContext(bundle.outputFiles[0].text, world);
        const rows = [], phases = [];
        const loader = world.diagnostics.createCandidateLoader({
            getURL: assert.fail, getCandidate: assert.fail, register: assert.fail, ordinary: phase => phases.push(phase),
            trace: (event, fields) => rows.push([event, fields]),
        });
        assert.equal(await loader.load(1, () => true), false);
        assert.equal(await loader.load(2, () => true), false);
        assert.deepEqual(phases, ["before-import"]);
        assert.deepEqual(rows.map(([event, fields]) => [event, fields.asset, fields.stage, fields.result]), [
            ["candidate-load-stage", "control", "ordered-preflight", preflight ? "present" : "missing"],
            ["candidate-load-stage", "candidate", "ordered-preflight", "blocked-eager-umd"],
        ]);
    }
});
