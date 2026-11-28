import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const [variant, staged, packaged] = process.argv.slice(2);
const receipt = JSON.parse(await readFile(join(staged, "resources.sha256.json"), "utf8"));
assert.equal(receipt.variant, variant);
const manifest = JSON.parse(await readFile(join(packaged, "manifest.json"), "utf8"));
const ordered = variant.endsWith("-ordered-preflight");
const mode = ordered ? "ordered-preflight" : "dynamic";
assert.equal(receipt.mode, mode);
assert.equal(variant, `mv${manifest.manifest_version}${ordered ? "-ordered-preflight" : ""}`);
assert.deepEqual(manifest.content_scripts.map(entry => entry.js),
    [ordered ? ["ordered-preflight.js", "content.js"] : ["content.js"]]);
assert.equal(manifest.web_accessible_resources, undefined);
const files = {};
for (const name of Object.keys(receipt.files).sort()) {
    const bytes = await readFile(join(packaged, name));
    files[name] = createHash("sha256").update(bytes).digest("hex");
    assert.equal(files[name], receipt.files[name], `Packaged bytes differ for ${name}`);
}
// The iOS appex shares its resource directory with the executable and its Info.plist.
const scripts = (await readdir(packaged)).filter(name => /\.(?:m?js|html|json|txt)$/.test(name));
assert.deepEqual(scripts.sort(), Object.keys(files).sort());
const digest = createHash("sha256").update(JSON.stringify(files)).digest("hex");
assert.equal(digest, receipt.sha256);
console.log(`Verified ${variant} packaged resources: ${digest}`);
