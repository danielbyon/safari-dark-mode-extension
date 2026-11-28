import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Script, createContext } from "node:vm";
import { auditedFiles } from "./build.mjs";

const fixture = new URL("../tests/ordered-umd/", import.meta.url);
const auditedUMD = new URL("../node_modules/darkreader/darkreader.js", import.meta.url);

// At document_start the document element can exist before the head. The actual
// enable() can append its fallback stylesheet here. This realm has no CSS engine.
function startDocument() {
    const children = new Set();
    const documentElement = {
        appendChild(node) { node.parentNode = this; children.add(node); },
        removeChild(node) { node.parentNode = null; children.delete(node); },
        removeAttribute() {},
    };
    const querySelectorAll = selector => [...children].filter(node =>
        selector.startsWith(".") && node.classList.contains(selector.slice(1)));
    return Object.assign(new EventTarget(), {
        documentElement, head: null, readyState: "loading", hidden: false, querySelectorAll,
        querySelector: selector => querySelectorAll(selector)[0] ?? null,
        createElement() {
            const classes = new Set();
            return {style: {}, classList: {add: name => classes.add(name), contains: name => classes.has(name)}};
        },
    });
}

/** Run the fixture's classic scripts in manifest order. Each run gets a new content world and receiver. */
export async function compareOrdered(activation) {
    const manifest = JSON.parse(await readFile(new URL("manifest.json", fixture), "utf8"));
    const scripts = manifest.content_scripts[0].js;
    const received = [], probe = {activation, messages: [], pending: []};
    const world = {
        document: startDocument(), location: new URL("http://127.0.0.1/page.html"), crypto, URL, CustomEvent, Blob,
        addEventListener() {}, removeEventListener() {}, cancelAnimationFrame() {},
        MutationObserver: class { observe() {} disconnect() {} },
        offlineProbe: probe,
        chrome: {runtime: {
            sendMessage({type, id, phase}) {
                const receiverCount = received.filter(row => row.id === id && row.phase === phase).length + 1;
                received.push({id, phase, receiverCount});
                return Promise.resolve({type, id, phase, receiverCount});
            },
        }},
    };
    world.window = world.self = world.top = world;
    const realm = createContext(world, {codeGeneration: {strings: false, wasm: false}});
    let umdSHA256;
    for (const name of scripts) {
        const bytes = await readFile(name === "darkreader.js" ? auditedUMD : new URL(name, fixture));
        if (name === "darkreader.js") {
            umdSHA256 = createHash("sha256").update(bytes).digest("hex");
            assert.equal(umdSHA256, auditedFiles["darkreader.js"]);
        }
        new Script(bytes.toString("utf8"), {filename: name}).runInContext(realm, {timeout: 5000});
    }
    await Promise.all(probe.pending);
    const {pending, send, ...result} = probe;
    return {environment: "synthetic-classic-script", siteGrant: "assumed", runAt: manifest.content_scripts[0].run_at,
        scripts, umdSHA256, ...result, received};
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    console.log(JSON.stringify([await compareOrdered(true), await compareOrdered(false)], null, 2));
}
