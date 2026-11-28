import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../extension/popup.html", import.meta.url), "utf8");
const state = {
    type: "state", private: false, paused: false, renderer: "marker", access: "valid",
    savedRevision: 1, preview: null, decision: { reason: "active" },
    schedule: { days: [5], start: "22:00", end: "07:00" },
};

async function openPopup(t) {
    const controls = new Map();
    class Option {
        constructor(label, value = label) { this.value = value; this.disabled = false; }
    }
    class Control extends EventTarget {
        options = [];
        attributes = new Map();
        setAttribute(name, value) { this.attributes.set(name, value); }
        removeAttribute(name) { this.attributes.delete(name); delete this[name]; }
        value = "";
        checked = false;
        disabled = false;
        append(...children) {
            for (const child of children) if (child.id) controls.set(child.id, child);
        }
        add(option) {
            if (!this.options.length) this.value = option.value;
            this.options.push(option);
        }
    }
    // Read control IDs and choices from the shipped markup so mismatched wiring fails at startup.
    for (const [, , attrs, id] of html.matchAll(/<(\w+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
        const control = new Control();
        control.disabled = /\sdisabled\b/.test(attrs);
        controls.set(id, control);
    }
    for (const [, id, body] of html.matchAll(/<select\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
        for (const [, value, label] of body.matchAll(/<option(?: value="([^"]*)")?>([^<]+)<\/option>/g)) {
            controls.get(id).add(new Option(label, value));
        }
    }
    const sent = [];
    let receive;
    let disconnect;
    const port = {
        postMessage: message => sent.push(structuredClone(message)),
        onMessage: { addListener: handler => { receive = handler; } },
        onDisconnect: { addListener: handler => { disconnect = handler; } },
    };
    const control = id => controls.get(id);
    const globals = {
        Option, document: { getElementById: control, createElement: () => new Control() },
        browser: { runtime: { connect({ name }) { assert.equal(name, "probe-editor"); return port; } } },
    };
    for (const [key, value] of Object.entries(globals)) {
        const previous = Object.getOwnPropertyDescriptor(globalThis, key);
        Object.defineProperty(globalThis, key, { configurable: true, value });
        t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : Reflect.deleteProperty(globalThis, key));
    }
    await import(new URL(`../extension/popup.ts?${encodeURIComponent(t.name)}`, import.meta.url));
    const expectAction = (action, value) => {
        assert.equal(sent.length, 1, `Expected ${action} ${JSON.stringify(value)}, received ${JSON.stringify(sent)}`);
        const message = sent.shift();
        assert.equal(message.type, "action");
        assert.equal(message.action, action);
        assert.deepEqual(message.value, value);
    };
    expectAction("refresh");
    return {
        control, expectAction, sent, disconnect, receive,
        publish: changes => receive(structuredClone({ ...state, ...changes })),
        click(id) { if (!control(id).disabled) control(id).dispatchEvent(new Event("click")); },
        choose(id, value) {
            const node = control(id);
            const option = node.options.find(item => item.value === value);
            assert.ok(option, `Missing option ${value} for ${id}`);
            if (node.disabled || option.disabled) return false;
            node.value = value;
            const event = new Event("change");
            node.dispatchEvent(event);
            node.onchange?.(event);
            return true;
        },
    };
}

test("switching panels preserves the draft and exports only fixture evidence", async t => {
    const ui = await openPopup(t);
    ui.click("show-appearance");
    ui.choose("theme", "ocean");
    ui.click("show-permissions");
    assert.equal(ui.control("appearance-panel").hidden, true);
    assert.equal(ui.control("permissions-panel").hidden, false);
    assert.equal(ui.control("show-permissions").attributes.get("aria-pressed"), "true");
    for (const expected of ["deny", "allow", "ask"]) {
        ui.click(`compare-${expected}`);
        ui.expectAction("calibrate", { role: "top", expected });
    }
    ui.click("show-appearance");
    assert.equal(ui.control("theme").value, "ocean");
    const observation = {event:"marker-root-style", result:"applied", sequence:1, document:777,
        beforeColor:"rgb(24, 35, 50)", url:"https://private.invalid/", id:"private-id"};
    ui.publish({observations:[observation], instance:"private-instance"});
    ui.click("show-observations");
    const prefix = "data:application/json;charset=utf-8,";
    const exported = ui.control("export").href;
    assert.ok(exported.startsWith(prefix));
    const evidence = JSON.parse(decodeURIComponent(exported.slice(prefix.length)));
    assert.deepEqual(evidence.observations, [{event:"marker-root-style", result:"applied", sequence:1, beforeColor:"rgb(24, 35, 50)"}]);
    assert.equal(evidence.instance, undefined);
    assert.deepEqual(JSON.parse(ui.control("observations").textContent).observations, [observation]);
    ui.publish({private: true});
    assert.equal(ui.control("export").hidden, true);
    assert.equal(ui.control("export").href, undefined);
    ui.publish({});
    assert.equal(ui.control("export").hidden, false);
    ui.receive({type:"error", reason:"open-editor-on-fixture"});
    assert.equal(ui.control("export").href, undefined);
    ui.publish({});
    ui.receive(null);
    assert.equal(ui.control("export").href, undefined);
    ui.publish({});
    ui.publish({private: undefined});
    assert.equal(ui.control("export").href, undefined);
    ui.publish({});
    ui.disconnect();
    assert.equal(ui.control("export").href, undefined);
    assert.deepEqual(ui.sent, []);
});

test("refresh restores the background schedule and keeps unsubmitted edits during observation updates", async t => {
    const ui = await openPopup(t);
    const schedule = { days: [1, 3], start: "09:00", end: "17:00" };
    ui.publish({ schedule });
    assert.equal(ui.choose("start", "17:00"), false);
    assert.equal(ui.choose("end", "09:00"), false);
    assert.equal(ui.choose("start", "08:30"), true);
    assert.equal(ui.choose("end", "08:30"), false);
    assert.equal(ui.choose("end", "09:00"), true);
    assert.equal(ui.choose("start", "09:00"), false);
    ui.click("refresh");
    ui.expectAction("refresh");
    ui.publish({ schedule, paused: true, savedRevision: 2, decision: { reason: "paused" } });
    assert.equal(ui.control("pause").checked, true);
    assert.match(ui.control("status").textContent, /paused.*revision 2/);
    ui.click("apply-schedule");
    ui.expectAction("schedule", { days: [1, 3], start: "08:30", end: "09:00" });
});

test("private state disables the three save commands while the operator can still preview and refresh access", async t => {
    const ui = await openPopup(t);
    ui.publish({ private: true, renderer: "candidate", access: "refreshing-valid" });
    assert.equal(ui.control("access").value, "refreshing-valid");
    assert.equal(ui.control("renderer").value, "candidate");
    for (const id of ["save-activation", "save-policy", "seed"]) {
        assert.equal(ui.control(id).disabled, true);
        ui.click(id);
    }
    assert.deepEqual(ui.sent, []);
    ui.choose("access", "refreshing-unknown");
    ui.expectAction("access", "refreshing-unknown");
    ui.choose("scope", "host");
    ui.choose("theme", "ocean");
    ui.choose("color", "inherit");
    ui.click("preview");
    ui.expectAction("preview", { scope: "host", fields: { theme: "ocean", linkColor: null } });
});

test("changing scope resends the live draft, including Use Default, and discard ends automatic sends", async t => {
    const ui = await openPopup(t);
    ui.publish({});
    ui.choose("scope", "host");
    ui.choose("color", "#ddaa55");
    ui.click("preview");
    ui.expectAction("preview", { scope: "host", fields: { linkColor: "#ddaa55" } });
    ui.publish({ preview: { scope: { kind: "host", hostname: "fixture.test" }, edits: { linkColor: "#ddaa55" } } });
    ui.choose("scope", "page");
    ui.expectAction("preview", { scope: "page", fields: { linkColor: "#ddaa55" } });
    ui.choose("color", "inherit");
    ui.expectAction("preview", { scope: "page", fields: { linkColor: null } });
    ui.click("discard");
    ui.expectAction("discard");
    ui.choose("scope", "global");
    assert.deepEqual(ui.sent, []);
    ui.click("seed");
    ui.expectAction("saved", { scope: "global", fields: { linkColor: null } });
});

test("moving the selector while the first preview is in flight reconciles the selected scope", async t => {
    const ui = await openPopup(t);
    ui.publish({});
    ui.choose("scope", "host");
    ui.choose("theme", "ocean");
    ui.click("preview");
    ui.expectAction("preview", { scope: "host", fields: { theme: "ocean" } });
    const moved = ui.choose("scope", "page");
    ui.publish({ preview: { scope: { kind: "host", hostname: "fixture.test" }, edits: { theme: "ocean" } } });
    if (!moved) assert.equal(ui.choose("scope", "page"), true);
    ui.expectAction("preview", { scope: "page", fields: { theme: "ocean" } });
});
