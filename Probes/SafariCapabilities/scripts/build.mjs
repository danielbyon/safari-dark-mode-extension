import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { parseOrigins } from "../fixtures/origins.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const candidate = join(root, "node_modules/darkreader");
const expectedIntegrity = "sha512-h/gmS/KzY8HgmsgOSFh7ssJnsC5ymuhIwZqxksPKCS1K400OUJyjDPZN1L2YIrzX+oezhVUNnCDZPfmPUvdJNA==";
export const auditedFiles = {
    "darkreader.js": "6bc5cb7bc3dd4014902a73898cfad95e07474755d64abbfe9e7bac02c2f59937",
    "LICENSE": "f0a5f835174494f8981b2cbb1a34054d4f887a5c865318650d6a17afe1c7850e",
};

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
async function verifyCandidate() {
    const lock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
    const dist = lock.packages["node_modules/darkreader"];
    if (dist?.version !== "4.9.135" || dist.integrity !== expectedIntegrity) {
        throw new Error("Dark Reader lock entry differs from the audited tarball");
    }
    for (const [name, expected] of Object.entries(auditedFiles)) {
        if (sha256(await readFile(join(candidate, name))) !== expected) {
            throw new Error(`Unexpected audited file digest: ${name}`);
        }
    }
}

function matches(list) {
    return [...new Set(list.map(origin => {
        const {protocol, hostname} = new URL(origin);
        return `${protocol}//${hostname}/*`;
    }))];
}

/** The receipt covers every staged file. Its own digest sits outside the extension. */
export async function resourceReceipt(outdir) {
    const files = {};
    for (const name of (await readdir(outdir)).sort()) {
        files[name] = sha256(await readFile(join(outdir, name)));
    }
    return {files, sha256: sha256(JSON.stringify(files))};
}

export async function stageExtensions({ mode, origins, outputRoot = join(root, ".build") }) {
    if (mode !== "dynamic" && mode !== "ordered-preflight") throw new Error("Unknown probe loader mode");
    origins = parseOrigins(origins);
    await verifyCandidate();
    const ordered = mode === "ordered-preflight";
    for (const version of [2, 3]) {
        const variant = `mv${version}${ordered ? "-ordered-preflight" : ""}`;
        const outdir = join(outputRoot, variant, "extension");
        await rm(outdir, { recursive: true, force: true });
        await mkdir(outdir, { recursive: true });
        const manifest = JSON.parse(await readFile(join(root, `extension/manifest-v${version}.json`), "utf8"));
        manifest.name += ordered ? " Ordered Preflight" : " Dynamic";
        manifest.content_scripts[0].matches = matches([origins.top, origins.frame, origins.denied]);
        const entries = ["extension/content.ts", "extension/popup.ts", "extension/background.ts"];
        if (ordered) {
            entries.push("extension/ordered-preflight.ts");
            manifest.content_scripts[0].js.unshift("ordered-preflight.js");
        }
        const hosts = matches(Object.values(origins));
        if (version === 2) manifest.permissions.push(...hosts);
        else manifest.host_permissions = hosts;
        await build({
            absWorkingDir: root, entryPoints: entries, outdir, bundle: true, format: "iife",
            target: "es2020", charset: "utf8",
            define: { __PROBE_ORIGINS__: JSON.stringify(origins), __PROBE_LOADER_MODE__: JSON.stringify(mode) },
        });
        await writeFile(join(outdir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
        for (const file of ["popup.html", "packaged-control.mjs"]) {
            await copyFile(join(root, "extension", file), join(outdir, file));
        }
        await copyFile(join(candidate, "darkreader.js"), join(outdir, "darkreader.js"));
        await copyFile(join(candidate, "LICENSE"), join(outdir, "DarkReader-LICENSE.txt"));
        const receipt = {variant, mode, ...await resourceReceipt(outdir)};
        await writeFile(join(outputRoot, variant, "resources.sha256.json"), `${JSON.stringify(receipt, null, 2)}\n`);
        console.log(`Staged ${variant} (${mode}): ${receipt.sha256}`);
    }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    const [mode = "dynamic", ...extra] = process.argv.slice(2);
    if (extra.length) throw new Error("Expected a single probe loader mode");
    await stageExtensions({mode, origins: process.env.SAFARI_PROBE_ORIGINS ?? "{}"});
}
