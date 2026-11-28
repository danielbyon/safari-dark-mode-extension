import assert from "node:assert/strict";
import test from "node:test";
import { TabLifecycle } from "../extension/lifecycle.ts";
import { DEFAULT_PREFERENCES, decideEligibility, resolvePreferences } from "../extension/eligibility.ts";

const first = { documentId: "doc-a", url: "https://one.example.test/docs" };
const host = { kind: "host", hostname: "one.example.test" };
const draft = { scope: host, edits: { theme: "ocean" } };
const newTab = () => new TabLifecycle(11, first, "live-tab-a");
const preferences = resolvePreferences(DEFAULT_PREFERENCES, { url: new URL(first.url) });
const ordinary = {
  preferences: { ...preferences, activation: "on" }, topAuthorized: true, frameAuthorized: true,
  access: "valid", paused: false, preview: false, tabOverride: null, systemDark: true,
  scheduleActive: false, topNativeDark: false, frameNativeDark: false,
};

test("observed URL and document changes expire the editor, including same-URL reload", () => {
  for (const next of [
    { ...first, documentId: "doc-b" }, { ...first, url: `${first.url}/next` },
    { ...first, url: `${first.url}?v=1` }, { ...first, url: `${first.url}#a` },
    { ...first, url: "https://two.example.test/docs" },
  ]) {
    const tab = newTab();
    const editor = tab.openEditor();
    tab.setOverride("off");
    assert.equal(tab.setPreview(editor, draft), true);
    const job = tab.beginWork();
    tab.navigate(next);
    assert.equal(tab.preview, null);
    assert.equal(tab.setPreview(editor, draft), false);
    assert.equal(tab.isCurrent(job), false);
    assert.equal(tab.tabOverride, next.url.includes("two.example") ? null : "off");
    tab.navigate(first);
    assert.equal(tab.preview, null);
    assert.equal(tab.setPreview(editor, draft), false);
  }
});

test("a repeated document and URL retain the editor across DOM or unchanged history events", () => {
  const tab = newTab();
  const editor = tab.openEditor();
  tab.setPreview(editor, draft);
  const job = tab.beginWork();
  tab.navigate({ ...first });
  assert.equal(tab.isCurrent(job), true);
  assert.deepEqual(tab.preview, draft);
});

test("a scope change retains edits and a stale popup disconnect cannot dismiss the current editor", () => {
  const tab = newTab();
  const old = tab.openEditor();
  tab.setPreview(old, draft);
  const editor = tab.openEditor();
  assert.equal(tab.preview, null);
  assert.equal(tab.setPreview(old, draft), false);
  tab.setPreview(editor, draft);
  const job = tab.beginWork();
  const page = { ...host, kind: "page", path: "/docs" };
  assert.equal(tab.changeScope(editor, page), true);
  assert.deepEqual(tab.preview, { scope: page, edits: draft.edits });
  assert.equal(tab.closeEditor(old), false);
  assert.equal(tab.changeScope(old, host), false);
  assert.equal(tab.isCurrent(job), false);
  assert.equal(tab.closeEditor(editor), true);
  assert.equal(tab.preview, null);
});

test("only a proven live tab on the same host can restore an override after background suspension", () => {
  const tab = newTab();
  tab.setOverride("off");
  tab.setPreview(tab.openEditor(), draft);
  const record = tab.overrideRecord;
  assert.deepEqual(record, { tabId: 11, lifetimeId: "live-tab-a", hostname: host.hostname, value: "off" });
  const resumed = newTab();
  assert.equal(resumed.restoreOverride(record), true);
  assert.equal(resumed.tabOverride, "off");
  assert.equal(resumed.preview, null);
  for (const other of [
    new TabLifecycle(12, first, "live-tab-a"),
    new TabLifecycle(11, first, "new-lifetime"),
    new TabLifecycle(11, { ...first, url: "https://other.test/" }, "live-tab-a"),
  ]) {
    assert.equal(other.restoreOverride(record), false);
    assert.equal(other.tabOverride, null);
  }
  resumed.setOverride(null);
  assert.equal(resumed.overrideRecord, null);
  tab.navigate({ ...first, url: "https://other.test/" });
  tab.navigate(first);
  assert.equal(tab.tabOverride, null);
});

test("tab closure aborts work and old identities cannot affect another tab or reopened document", () => {
  const tab = newTab();
  const other = new TabLifecycle(12, first, "another-tab");
  const job = tab.beginWork();
  const unaffected = other.beginWork();
  const editor = tab.openEditor();
  tab.setOverride("on");
  tab.setPreview(editor, draft);
  const pending = tab.beginWork();
  tab.close();
  assert.equal(pending.signal.aborted, true);
  assert.equal(other.isCurrent(unaffected), true);
  assert.equal(other.isCurrent(job), false);
  assert.equal(tab.setPreview(editor, draft), false);
  assert.equal(tab.preview, null);
  assert.equal(tab.overrideRecord, null);
  assert.equal(tab.isCurrent(tab.beginWork()), false);
  assert.equal(newTab().isCurrent(pending), false);
});

test("a late session-storage response cannot reinstate a cleared override or one from a previous hostname", () => {
  const suspended = newTab();
  suspended.setOverride("off");
  const record = suspended.overrideRecord;
  for (const endOverride of [
    tab => tab.setOverride(null),
    tab => {
      tab.navigate({ ...first, url: "https://other.test/" });
      tab.navigate(first);
    },
    tab => tab.close(),
  ]) {
    const tab = newTab();
    endOverride(tab);
    assert.equal(tab.restoreOverride(record), false);
    assert.equal(tab.tabOverride, null);
  }
  const restarted = newTab();
  for (const invalid of [null, "", {}, { ...record, value: "expired" }]) {
    assert.equal(restarted.restoreOverride(invalid), false);
  }
});

test("withdrawn editor handles cannot revive a preview after dismissal or closure", () => {
  const tab = newTab();
  const editor = tab.openEditor();
  assert.equal(tab.changeScope(editor, host), false);
  tab.closeEditor(editor);
  assert.equal(tab.setPreview(null, draft), false);
  assert.equal(tab.closeEditor(null), false);
  tab.close();
  tab.navigate(first);
  tab.invalidate();
  assert.equal(tab.setOverride("off"), false);
  assert.equal(tab.preview, null);
  assert.throws(() => tab.openEditor(), /closed/);
});

test("a fresh decision is visible even inside the old operation's abort handler", () => {
  const tab = newTab();
  const work = tab.beginWork();
  let replacement;
  work.signal.addEventListener("abort", () => { replacement = tab.beginWork(); });
  tab.setOverride("on");
  assert.equal(tab.isCurrent(replacement), true);
  assert.equal(tab.isCurrent(work), false);
  tab.setOverride("on");
  assert.equal(tab.isCurrent(replacement), true);
});

for (const [event, initial, patch, expected] of [
  ["no change", {}, null, "active"],
  ["pause", {}, { paused: true }, "paused"],
  ["access expires", {}, { access: "inactive" }, "access-inactive"],
  ["access revoked for the top document", {}, { topAuthorized: false }, "permission"],
  ["access revoked for the frame", {}, { frameAuthorized: false }, "permission"],
  ["saved activation turns off", {}, { preferences: { ...preferences, activation: "off" } }, "saved-off"],
  ["draft dismissed to eligible saved behavior", { preview: true }, { preview: false }, "active"],
  ["draft dismissed to saved Off", { preview: true, preferences: { ...preferences, activation: "off" } }, { preview: false }, "saved-off"],
  ["saved Off during preview", { preview: true }, { preferences: { ...preferences, activation: "off" } }, "preview"],
  ["appearance superseded", {}, { preferences: { ...ordinary.preferences, appearance: { ...preferences.appearance, brightness: 65 } } }, "active"],
]) {
  test(`late work after ${event} cannot overwrite the current appearance`, async () => {
    const tab = newTab();
    const decision = { ...ordinary, ...initial };
    const old = tab.beginWork();
    let displayed = null;
    let release;
    const delayed = new Promise(resolve => { release = resolve; }).then(() => {
      if (tab.isCurrent(old)) displayed = decision.preferences.appearance;
    });
    const latest = { ...decision, ...patch };
    if (patch) {
      tab.invalidate();
      displayed = decideEligibility(latest).render ? latest.preferences.appearance : null;
    }
    release();
    await delayed;
    assert.equal(old.signal.aborted, Boolean(patch));
    assert.equal(tab.isCurrent(old), !patch);
    assert.equal(decideEligibility(latest).reason, expected);
    assert.deepEqual(displayed, decideEligibility(latest).render ? latest.preferences.appearance : null);
  });
}
