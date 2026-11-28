import assert from "node:assert/strict";
import { test } from "node:test";
import { CandidateReads, FrameRenderer, effectSample } from "../extension/renderer.ts";

const noop = () => {};

test("only the first eligible generation can release stylesheet bytes in a document", async () => {
    const work = Promise.withResolvers();
    let revision = 3;
    let calls = 0;
    let readSignal;
    const events = [];
    const reads = new CandidateReads(async (_url, _revision, signal) => {
        readSignal = signal;
        return ++calls === 1 ? "p {}" : work.promise;
    }, (value) => value === revision, (event) => events.push(event));
    await assert.rejects(reads.fetch("sheet"), /Unattributable/);
    reads.bind(3);
    const response = await reads.fetch("sheet");
    assert.equal(await response.text(), "p {}");
    assert.equal(response.headers.get("Content-Type"), "text/css");
    const pending = reads.fetch("sheet");
    revision++;
    reads.bind(4);
    assert.equal(readSignal.aborted, true);
    work.resolve("stale");
    await assert.rejects(pending, /Expired/);
    await assert.rejects(reads.fetch("sheet"), /Unattributable/);
    assert.equal(calls, 2);
    assert.ok(events.includes("stale-response-rejected"));
});

test("a changed decision blocks delivery even before the abort arrives", async () => {
    let eligible = true;
    const reads = new CandidateReads(async () => {
        eligible = false;
        return ".late {}";
    }, () => eligible, noop);
    reads.bind(1);
    await assert.rejects(reads.fetch("sheet"), /Expired/);
});

const input = { revision: 1, enabled: true, privileged: true, fix: true, renderer: "marker", appearance: { mode: "adaptive", brightness: 72, linkColor: "#454545" } };

test("the reversible marker and fix own one style element", () => {
    const nodes = new Set(["website"]);
    const doc = { head: { append: (node) => nodes.add(node) }, createElement: () => {
        const style = { remove: () => nodes.delete(style) };
        return style;
    } };
    const renderer = new FrameRenderer(doc, new CandidateReads(noop, noop, noop), noop, noop);
    renderer.apply({ ...input, enabled: false });
    assert.deepEqual([...nodes], ["website"]);
    renderer.apply(input);
    const [, node] = nodes;
    assert.match(node.textContent, /#fixture-essential-control:focus \{/);
    assert.match(node.textContent, /#454545/);
    assert.doesNotMatch(node.textContent, /deliberate-low-contrast/);
    renderer.apply({ ...input, appearance: { ...input.appearance, mode: "palette" } });
    assert.equal(nodes.size, 2);
    assert.equal(nodes.has(node), false);
    renderer.apply({ ...input, fix: false });
    assert.doesNotMatch([...nodes][1].textContent, /#fixture-essential-control/);
    renderer.disable();
    assert.deepEqual([...nodes], ["website"]);
    assert.throws(() => renderer.apply({ ...input, appearance: { ...input.appearance, linkColor: "red; }" } }), /Invalid/);
});

const website = { color: "rgb(24, 35, 50)", backgroundColor: "rgb(250, 250, 250)" };
const adaptive = { color: "rgb(224, 244, 255)", backgroundColor: "rgb(24, 26, 27)" };
const palette = { color: "rgb(224, 244, 255)", backgroundColor: "rgb(17, 37, 53)" };

// CSSOM exposes live declarations. Read each property against the current node set.
function markerDocument(before, after) {
    let style;
    const colors = () => style ? after : before;
    const live = {
        get color() { return colors().color; },
        get backgroundColor() { return colors().backgroundColor; },
    };
    const root = {};
    return {
        documentElement: root,
        createElement: () => ({ remove() { style = undefined; } }),
        head: { append(node) { style = node; } },
        defaultView: { getComputedStyle(node) { assert.equal(node, root); return live; } },
        get inserted() { return style; },
    };
}

for (const [name, before, after, mode, result] of [
    ["ordinary light", website, adaptive, "adaptive", "applied"],
    ["inserted style with no computed effect", website, website, "adaptive", "unchanged"],
    ["website already has both marker colors", adaptive, adaptive, "adaptive", "already-matched"],
    ["only the foreground changes", website, { ...website, color: adaptive.color }, "adaptive", "mismatch"],
    ["palette mode", website, palette, "palette", "applied"],
    ["missing baseline", {}, adaptive, "adaptive", "unavailable"],
    ["missing background after append", website, { color: adaptive.color }, "adaptive", "unavailable"],
]) {
    test(`marker root measurements: ${name}`, () => {
        const doc = markerDocument(before, after);
        const events = [];
        const renderer = new FrameRenderer(doc, new CandidateReads(noop, noop, noop),
            (event, fields) => events.push({ event, ...fields }), noop);
        renderer.apply({ ...input, enabled: false });
        assert.equal(doc.inserted, undefined);
        assert.deepEqual(events, []);

        renderer.apply({ ...input, appearance: { ...input.appearance, mode } });
        const expected = mode === "palette" ? palette : adaptive;
        assert.ok(doc.inserted);
        assert.deepEqual(events, [
            { event: "marker-inserted", revision: 1, fixVersion: 1 },
            { event: "marker-root-style", revision: 1, result,
                beforeColor: before.color ?? null, beforeBackground: before.backgroundColor ?? null,
                expectedColor: expected.color, expectedBackground: expected.backgroundColor,
                afterColor: after.color ?? null, afterBackground: after.backgroundColor ?? null },
        ]);
        assert.ok(doc.inserted.textContent.includes(`background-color: ${expected.backgroundColor} !important`));
        assert.ok(doc.inserted.textContent.includes(`color: ${expected.color} !important`));

        renderer.apply({ ...input, enabled: false });
        assert.equal(doc.inserted, undefined);
        assert.equal(doc.defaultView.getComputedStyle(doc.documentElement).color, before.color);
        assert.equal(events.length, 2);
    });
}

test("an unavailable style read still reports insertion and leaves teardown available", () => {
    const doc = markerDocument(website, adaptive);
    doc.defaultView.getComputedStyle = () => { throw new Error("style unavailable"); };
    const events = [];
    const renderer = new FrameRenderer(doc, new CandidateReads(noop, noop, noop),
        (event, fields) => events.push({ event, ...fields }), noop);
    renderer.apply(input);
    assert.ok(doc.inserted);
    assert.equal(events[0].event, "marker-inserted");
    assert.equal(events[1].result, "unavailable");
    assert.equal(events[1].afterColor, null);
    renderer.disable();
    assert.equal(doc.inserted, undefined);
});

test("a failed candidate enable tears down partial output; eligible revisions use the public fix argument", async () => {
    const events = [];
    let hook;
    let fail = true;
    const reads = new CandidateReads(async () => "ok", () => true, noop);
    const renderer = new FrameRenderer({}, reads, noop, () => events.push("after-disable"));
    const candidateInput = { ...input, renderer: "candidate", appearance: { ...input.appearance, mode: "palette" } };
    assert.throws(() => renderer.apply(candidateInput), /unavailable/);
    renderer.register({
        setFetchMethod: (fetch) => { hook = fetch; },
        enable: (theme, fixes) => {
            assert.equal(theme.brightness, 72);
            assert.ok(theme.darkSchemeBackgroundColor);
            assert.match(fixes.css, /#fixture-essential-control/);
            events.push("enable");
            if (fail) throw new Error("incomplete enable");
        },
        disable: () => events.push("disable"),
        isEnabled: () => !fail,
    });
    assert.throws(() => renderer.apply(candidateInput), /incomplete enable/);
    assert.deepEqual(events, ["enable", "disable", "after-disable"]);
    fail = false;
    renderer.apply({ ...candidateInput, revision: 2 });
    await assert.rejects(hook("sheet"), /Unattributable/);
    renderer.apply({ ...candidateInput, revision: 3, enabled: false });
    assert.deepEqual(events.slice(3), ["enable", "disable", "after-disable"]);
});

test("effect samples detect a CSSOM-only change with a stable node and rule count", () => {
    const rule = { cssText: "p { color: red; }" };
    const style = { sheet: { cssRules: [rule] } };
    const doc = { querySelectorAll: () => [style], querySelector: () => null };
    const before = effectSample(doc);
    rule.cssText = "p { color: tan; }";
    const after = effectSample(doc);
    assert.equal(after.sheets, before.sheets);
    assert.equal(after.rules, before.rules);
    assert.notEqual(after.hash, before.hash);
});

test("the audited UMD forwards ordinary messages but drops their promise on import and after disable", async () => {
    const calls = [];
    const runtime = { sendMessage(phase) { calls.push(phase); return Promise.resolve("host-reply"); } };
    const surface = {
        chrome: { runtime }, window: Object.assign(new EventTarget(), { chrome: { runtime } }),
        location: new URL("https://fixture.test/"),
        document: Object.assign(new EventTarget(), { hidden: false, readyState: "complete",
            documentElement: { removeAttribute: noop }, querySelector: () => null, querySelectorAll: () => [] }),
        cancelAnimationFrame: noop,
    };
    Object.assign(globalThis, surface);
    try {
        assert.equal(await runtime.sendMessage("before"), "host-reply");
        await import("../node_modules/darkreader/darkreader.js");
        assert.equal(runtime.sendMessage("after"), undefined);
        globalThis.DarkReader.disable();
        assert.equal(runtime.sendMessage("disabled"), undefined);
        assert.deepEqual(calls, ["before", "after", "disabled"]);
    } finally {
        for (const key of [...Object.keys(surface), "DarkReader"]) delete globalThis[key];
    }
});

test("response handoff and the candidate's body consumption are separate boundaries", async () => {
    const events = [];
    const reads = new CandidateReads(async () => "p {}", () => true, event => events.push(event));
    reads.bind(1);
    const response = await reads.fetch("sheet");
    assert.deepEqual(events, ["candidate-hook-entry", "candidate-response-released"]);
    assert.equal(await (await response.blob()).text(), "p {}");
    assert.equal(events.at(-1), "candidate-body-delivered");
    const late = await reads.fetch("sheet");
    reads.invalidate();
    await assert.rejects(late.text(), /Expired/);
    assert.equal(events.at(-1), "stale-response-rejected");
});

test("an opaque generated sheet leaves the visible swatch and focus measurements available", () => {
    const swatch = {};
    const control = {};
    const opaque = { get cssRules() { throw new Error("unreadable"); } };
    const doc = {
        querySelectorAll: () => [{ sheet: opaque }, { sheet: null }],
        querySelector: selector => selector === "#resource-swatch" ? swatch : control,
        documentElement: { getAttribute: () => "dynamic" },
        defaultView: { getComputedStyle: node => node === control ? { outlineWidth: "2px" } :
            { color: "rgb(17, 68, 119)", backgroundColor: "rgb(249, 221, 151)", borderLeftColor: "rgb(39, 112, 82)" } },
    };
    assert.deepEqual(effectSample(doc), {
        sheets: 2, opaque: 1, rules: 0, hash: 0, mode: "dynamic", controlOutline: "2px",
        swatchColor: "rgb(17, 68, 119)", swatchBackground: "rgb(249, 221, 151)", swatchBorder: "rgb(39, 112, 82)",
    });
});
