import assert from "node:assert/strict";
import { test } from "node:test";
import { captureNativeDark } from "../extension/native-dark.ts";

const media = (mediaText = "") => ({ mediaText });
const declaration = (scheme, selectorText = ":root") => ({
    type: 1, selectorText, style: { getPropertyValue: (name) => name === "color-scheme" ? scheme : "" },
});
const sheet = (...cssRules) => ({ cssRules, media: media(), disabled: false, ownerNode: { isConnected: true } });

test("only an unambiguous site root declaration establishes a scheme", () => {
    for (const [rules, expected] of [
        [[declaration("dark", ".hero")], ["unknown", "no-declaration"]],
        [[declaration("")], ["unknown", "no-declaration"]],
        [[declaration("dark", "html")], ["dark", "root-declaration"]],
        [[declaration("light"), declaration("light", "html")], ["light", "root-declaration"]],
        [[declaration("light dark")], ["unknown", "ambiguous"]],
        [[declaration("light"), declaration("dark")], ["unknown", "ambiguous"]],
    ]) {
        const detect = captureNativeDark([sheet(...rules)], () => true);
        assert.deepEqual(detect(), { scheme: expected[0], reason: expected[1] });
    }
});

test("repeated reads exclude later renderer sheets and track site CSSOM edits", () => {
    const source = sheet(declaration("light"));
    const inventory = [source];
    const detect = captureNativeDark(inventory, () => true);
    inventory.push(sheet(declaration("dark")));
    for (let i = 0; i < 3; i++) assert.equal(detect().scheme, "light");
    source.cssRules[0] = declaration("dark");
    assert.equal(detect().scheme, "dark");
    source.cssRules[0] = declaration("light");
    assert.equal(detect().scheme, "light");
    source.ownerNode.isConnected = false;
    assert.equal(detect().scheme, "unknown");
});

test("sheet media, nested media and disabled sheets follow the site's current state", () => {
    const light = sheet(declaration("light"));
    const dark = sheet({ type: 4, media: media("inner"), cssRules: [declaration("dark")] });
    dark.media = media("outer");
    const matches = new Set();
    const detect = captureNativeDark([light, dark], (query) => matches.has(query));
    assert.equal(detect().scheme, "light");
    light.disabled = true;
    matches.add("outer");
    assert.equal(detect().scheme, "unknown");
    matches.add("inner");
    assert.equal(detect().scheme, "dark");
    light.disabled = false;
    matches.delete("outer");
    assert.equal(detect().scheme, "light");
});

test("opaque sheets and unsupported grouping leave the classification open", () => {
    const opaque = sheet();
    Object.defineProperty(opaque, "cssRules", { get() { throw new Error("CSSOM denied"); } });
    for (const source of [opaque, sheet({ type: 3 }), sheet({ type: 12, cssRules: [] })]) {
        const detect = captureNativeDark([sheet(declaration("dark")), source], () => true);
        assert.deepEqual(detect(), { scheme: "unknown", reason: "unreadable" });
    }
});

test("a missing source or a replaced sheet cannot supply a native-dark result", () => {
    const source = sheet(declaration("dark"));
    assert.equal(captureNativeDark([source], () => true, true)().reason, "unreadable");
    source.ownerNode.sheet = source;
    const detect = captureNativeDark([source], () => true);
    assert.equal(detect().scheme, "dark");
    source.ownerNode.sheet = sheet(declaration("light"));
    assert.equal(detect().reason, "unreadable");
});
