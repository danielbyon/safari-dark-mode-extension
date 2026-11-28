import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PREFERENCES, THEMES, resolvePreferences, decideEligibility,
} from "../extension/eligibility.ts";

const page = { url: new URL("https://www.example.test/docs/api/start?q=1#anchor"), domain: "example.test" };
const domain = { kind: "domain", domain: "example.test" };
const host = { kind: "host", hostname: "www.example.test" };
const section = { ...host, kind: "section", path: "/docs" };
const subsection = { ...section, path: "/docs/api" };
const path = { ...host, kind: "page", path: "/docs/api/start" };
const saved = {
  revision: 4, defaults: { activation: "off", theme: "graphite" },
  rules: [
    { scope: path, values: { brightness: 75 } },
    { scope: subsection, values: { linkColor: "#508050" } },
    { scope: host, values: { theme: "ocean" } },
    { scope: section, values: { activation: "on" } },
    { scope: domain, values: { linkColor: "#338833" } },
  ],
};

test("each appearance field follows its own scope, independently of theme and storage order", () => {
  const p = resolvePreferences(saved, page);
  assert.deepEqual(p.appearance, { theme: "ocean", mode: "palette", brightness: 75, linkColor: "#508050" });
  assert.equal(p.activation, "on");
  assert.deepEqual(p.sources.linkColor, subsection);
  assert.deepEqual(p.sources.brightness, path);
  assert.equal(p.savedRevision, 4);
});

test("site matching ignores scheme, port, query and fragment and respects path segments and case", () => {
  for (const [address, brightness, activation] of [
    ["http://www.example.test:8001/docs/api/start?other#new", 75, "on"],
    ["https://www.example.test/docs", 100, "on"],
    ["https://www.example.test/docs-old", 100, "off"],
    ["https://www.example.test/DOCS/api/start", 100, "off"],
    ["https://www.example.test/docs%2Fapi/start", 100, "off"],
  ]) {
    const p = resolvePreferences(saved, { ...page, url: new URL(address) });
    assert.equal(p.appearance.brightness, brightness, address);
    assert.equal(p.activation, activation, address);
  }
});

test("domain matching requires an explicit fixture domain and distinct hostname scopes", () => {
  const sibling = { ...page, url: new URL("https://sibling.example.test/docs") };
  assert.equal(resolvePreferences(saved, sibling).appearance.linkColor, "#338833");
  assert.equal(resolvePreferences(saved, sibling).appearance.theme, "graphite");
  assert.equal(resolvePreferences(saved, { url: sibling.url }).appearance.linkColor, THEMES.graphite.linkColor);
  const unrelated = { ...page, url: new URL("https://unrelated.test") };
  assert.equal(resolvePreferences(saved, unrelated).appearance.linkColor, THEMES.graphite.linkColor);
});

test("drafts can edit a new scope, move to a narrower scope and reveal the current inherited value", () => {
  const original = structuredClone(saved);
  const edits = { linkColor: "#dddd00" };
  const broader = resolvePreferences(saved, page, { scope: domain, edits });
  assert.equal(broader.appearance.linkColor, "#508050");
  const narrower = resolvePreferences(saved, page, { scope: path, edits });
  assert.equal(narrower.appearance.linkColor, "#dddd00");
  const removal = resolvePreferences(saved, page, { scope: subsection, edits: { linkColor: null } });
  assert.equal(removal.appearance.linkColor, "#338833");
  assert.deepEqual(removal.sources.linkColor, domain);
  const newScope = { ...section, path: "/docs/api/start" };
  assert.equal(resolvePreferences(saved, page, { scope: newScope, edits }).appearance.linkColor, "#dddd00");
  assert.deepEqual(saved, original);
});

test("changing saved preferences during a draft updates every unedited value", () => {
  const draft = { scope: host, edits: { theme: "graphite" } };
  const updated = { ...saved, revision: 5, rules: saved.rules.filter(r => r.scope !== path) };
  assert.equal(resolvePreferences(saved, page, draft).appearance.brightness, 75);
  const active = resolvePreferences(updated, page, draft);
  assert.equal(active.appearance.brightness, 100);
  assert.equal(active.appearance.theme, "graphite");
  assert.equal(active.savedRevision, 5);
  assert.equal(resolvePreferences(updated, page).appearance.theme, "ocean");
});

test("global draft edits are resolved under site overrides and removal reveals the selected theme", () => {
  const prefs = { ...saved, defaults: { brightness: 60, theme: "graphite", linkColor: "#aaaaaa" } };
  const changes = { scope: { kind: "default" }, edits: { theme: "ocean", brightness: null } };
  assert.equal(resolvePreferences(prefs, page, changes).appearance.brightness, 75);
  const plain = { url: new URL("https://unrelated.test/") };
  const p = resolvePreferences(prefs, plain, changes);
  assert.equal(p.appearance.theme, "ocean");
  assert.equal(p.appearance.brightness, THEMES.ocean.brightness);
  assert.equal(p.appearance.linkColor, "#aaaaaa");
});

const prefs = resolvePreferences(DEFAULT_PREFERENCES, page);
const base = {
  preferences: { ...prefs, activation: "on" }, topAuthorized: true, frameAuthorized: true,
  access: "valid", paused: false, preview: false, tabOverride: null, systemDark: false,
  scheduleActive: false, topNativeDark: false, frameNativeDark: false,
};
for (const [reason, render, inputs] of [
  ["permission", false, { topAuthorized: false, access: "inactive", preview: true, paused: true }],
  ["permission", false, { frameAuthorized: false, preview: true }],
  ["access-inactive", false, { access: "inactive", paused: true, preview: true }],
  ["access-unknown", false, { access: "unknown", preview: true }],
  ["access-unknown", false, { access: "refreshing", preview: true }],
  ["active", true, { access: "refreshing-valid" }],
  ["paused", false, { paused: true, tabOverride: "on", preview: true }],
  ["preview", true, { preview: true, topNativeDark: true, frameNativeDark: true, tabOverride: "off" }],
  ["tab-off", false, { tabOverride: "off" }],
  ["active", true, { tabOverride: "on", preferences: { ...prefs, activation: "off" } }],
  ["saved-off", false, { preferences: { ...prefs, activation: "off", useMyTheme: true } }],
  ["system-light", false, { preferences: { ...prefs, activation: "follow-system" } }],
  ["active", true, { preferences: { ...prefs, activation: "follow-system" }, systemDark: true }],
  ["outside-schedule", false, { preferences: { ...prefs, activation: "schedule" } }],
  ["active", true, { preferences: { ...prefs, activation: "schedule" }, scheduleActive: true }],
  ["native-dark", false, { topNativeDark: true }],
  ["native-dark", false, { frameNativeDark: true, tabOverride: "on" }],
  ["active", true, { frameNativeDark: true, preferences: { ...prefs, activation: "on", useMyTheme: true } }],
]) {
  test(`eligibility ${JSON.stringify(inputs)} returns ${reason} for rendering and fixes`, () => {
    const decision = decideEligibility({ ...base, ...inputs });
    assert.equal(decision.reason, reason);
    assert.equal(decision.render, render);
  });
}

test("embedded frames use the top-level preference and their own native-dark and permission inputs", () => {
  const frame = { url: new URL("https://frame.test/") };
  const top = resolvePreferences(saved, page);
  assert.equal(decideEligibility({ ...base, preferences: top }).render, true);
  assert.equal(decideEligibility({ ...base, preferences: top, frameAuthorized: false }).render, false);
  assert.equal(decideEligibility({ ...base, preferences: top, frameNativeDark: true }).render, false);
  assert.equal(decideEligibility({ ...base, preferences: resolvePreferences(saved, frame) }).reason, "saved-off");
});
