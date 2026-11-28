import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { build } from "esbuild";
import { parseOrigins } from "../fixtures/origins.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFile(join(root, path), "utf8");
const lock = JSON.parse(await read("package-lock.json"));
const expectedIntegrity = "sha512-h/gmS/KzY8HgmsgOSFh7ssJnsC5ymuhIwZqxksPKCS1K400OUJyjDPZN1L2YIrzX+oezhVUNnCDZPfmPUvdJNA==";
const dist = lock.packages["node_modules/darkreader"];
if (dist?.version !== "4.9.135" || dist.integrity !== expectedIntegrity) {
    throw new Error("Dark Reader lock entry differs from the audited tarball");
}
const candidate = join(root, "node_modules/darkreader");
const auditedFiles = {
    "darkreader.js": "6bc5cb7bc3dd4014902a73898cfad95e07474755d64abbfe9e7bac02c2f59937",
    "LICENSE": "f0a5f835174494f8981b2cbb1a34054d4f887a5c865318650d6a17afe1c7850e",
};
for (const [name, expected] of Object.entries(auditedFiles)) {
    const actual = createHash("sha256").update(await readFile(join(candidate, name))).digest("hex");
    if (actual !== expected) throw new Error(`Unexpected audited file digest: ${name}`);
}
const origins = parseOrigins(JSON.parse(process.env.SAFARI_PROBE_ORIGINS || "{}"));
const matches = (list) => [...new Set(list.map((origin) => {
    const { protocol, hostname } = new URL(origin);
    return `${protocol}//${hostname}/*`;
}))];
for (const version of [2, 3]) {
    const outdir = join(root, ".build", `mv${version}`, "extension");
    await rm(outdir, { recursive: true, force: true });
    await mkdir(outdir, { recursive: true });
    const manifest = JSON.parse(await read(`extension/manifest-v${version}.json`));
    manifest.content_scripts[0].matches = matches([origins.top, origins.frame, origins.denied]);
    const hosts = matches(Object.values(origins));
    if (version === 2) manifest.permissions.push(...hosts);
    else manifest.host_permissions = hosts;
    await build({
        absWorkingDir: root,
        entryPoints: ["extension/content.ts", "extension/popup.ts", "extension/background.ts"],
        outdir, bundle: true, format: "iife", target: "es2020", charset: "utf8",
        define: { __PROBE_ORIGINS__: JSON.stringify(origins) },
    });
    await writeFile(join(outdir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    await copyFile(join(root, "extension/popup.html"), join(outdir, "popup.html"));
    await copyFile(join(candidate, "darkreader.js"), join(outdir, "darkreader.js"));
    await copyFile(join(candidate, "LICENSE"), join(outdir, "DarkReader-LICENSE.txt"));
    console.log(`Staged MV${version} with verified Dark Reader 4.9.135`);
}
