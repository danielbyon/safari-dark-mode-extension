import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { DocumentReader, GrantCalibration, permissionPattern } from "../extension/resource-loader.ts";

const url = "https://styles.example.test/resource.css";
const css = ".distinctive { color: purple }";
const grants = { top: true, frame: true, resource: true, denied: false };

test("calibration needs actual allow and deny with the requester still authorized", () => {
    const calibration = new GrantCalibration();
    assert.equal(permissionPattern("http://localhost:8788"), "http://localhost/*");
    assert.equal(calibration.record("resource", "allow", grants).qualified, false);
    calibration.record("resource", "deny", {...grants, resource: false, top: false});
    assert.equal(calibration.qualified("resource", ["top"]), false);
    calibration.record("resource", "ask", {...grants, resource: false});
    assert.equal(calibration.qualified("resource", ["top"]), false);
    calibration.record("resource", "deny", {...grants, resource: false});
    assert.equal(calibration.qualified("resource", ["top", "frame", "resource"]), true);
    assert.equal(calibration.qualified("denied"), false);
    calibration.record("resource", "allow", {...grants, resource: null});
    assert.equal(calibration.qualified("resource"), false);
});

function response(address = url, details = {}) {
    return {ok: true, redirected: false, url: address, headers: new Headers({"Content-Type": "text/css; charset=UTF-8"}),
        text: async () => css, ...details};
}

function makeReader(extra = {}) {
    const events = [];
    const requests = [];
    const reader = new DocumentReader({
        destinations: new Set([url]), current: () => true, authorized: async () => true,
        trace: event => events.push(event),
        fetch: async (address, init) => { requests.push(init); return response(address.href); },
        ...extra,
    });
    reader.bind(1);
    return {reader, events, requests};
}

test("deliver only a fixture stylesheet from the current decision", async () => {
    let checks = 0;
    const {reader, requests} = makeReader({authorized: async () => { checks++; return true; }});
    assert.equal(reader.bind(1), true);
    assert.deepEqual(await reader.read(1, 1, url), {ok: true, css});
    assert.equal(checks, 2);
    assert.equal(requests.length, 1);
    const {signal, ...options} = requests[0];
    assert.equal(signal.aborted, false);
    assert.deepEqual(options, {method: "GET", credentials: "omit", redirect: "error",
        referrerPolicy: "no-referrer", cache: "no-store"});
    assert.equal((await reader.read(1, 1, url)).reason, "invalid-or-replayed-id");
    assert.equal((await reader.read(NaN, 1, url)).reason, "invalid-or-replayed-id");
    assert.equal((await reader.read(2, 0, url)).reason, "stale-decision");
    assert.equal(reader.bind(2), false);
    assert.equal(reader.bind(1), false);
    assert.equal((await reader.read(3, 2, url)).ok, false);
    assert.equal(requests.length, 1);
});

test("unknown origins, credentials, fragments, query changes and non-stylesheet routes never dispatch", async () => {
    const {reader, requests} = makeReader();
    let id = 0;
    for (const address of [`${url}?copy=1`, `${url}#test`, url.replace("styles.", "owner@styles."),
        url.replace("styles.", "other."), url.replace("resource.css", "control/release"), "about:blank"]) {
        assert.equal((await reader.read(++id, 1, address)).reason, "outside-fixture-routes");
    }
    assert.equal(requests.length, 0);
});

test("revocation or a stale identity during authorization prevents dispatch", async () => {
    for (const policy of ["denied", "disconnect", "exception"]) {
        let reader;
        let calls = 0;
        ({reader} = makeReader({authorized: async () => {
            if (policy === "disconnect") reader.invalidate();
            if (policy === "exception") throw Error();
            return policy !== "denied";
        }, fetch: async () => { calls++; return response(); }}));
        assert.equal((await reader.read(1, 1, url)).ok, false);
        assert.equal(calls, 0);
    }
});

test("retirement aborts pending transport even when it ignores the signal", async () => {
    const dispatched = Promise.withResolvers();
    const network = Promise.withResolvers();
    const {reader, events} = makeReader({fetch: (_url, {signal}) => {
        dispatched.resolve(signal);
        return network.promise;
    }});
    const pending = reader.read(1, 1, url);
    const signal = await dispatched.promise;
    reader.invalidate();
    assert.equal(signal.aborted, true);
    network.resolve(response());
    assert.deepEqual(await pending, {ok: false, reason: "stale-response-rejected"});
    assert.ok(events.includes("abort-requested"));
    assert.ok(!events.includes("stylesheet-ready"));
});

test("an abort-aware transport and an ordinary failure have different outcomes", async () => {
    const {reader} = makeReader({fetch: async () => { reader.invalidate(); throw new DOMException("Aborted", "AbortError"); }});
    assert.equal((await reader.read(1, 1, url)).reason, "read-aborted");
    const failed = makeReader({fetch: async () => { throw Error(); }});
    assert.equal((await failed.reader.read(1, 1, url)).reason, "read-failed");
});

test("delivery rechecks grants and handles invalidation during the final permission query", async () => {
    for (const policy of ["revoked", "replaced"]) {
        let checks = 0;
        let reader;
        ({reader} = makeReader({authorized: async () => {
            if (++checks === 1) return true;
            if (policy === "replaced") reader.invalidate();
            return policy === "replaced";
        }}));
        assert.equal((await reader.read(1, 1, url)).reason, "stale-response-rejected");
        assert.equal(checks, 2);
    }
});

test("unsuccessful, rewritten, redirected and non-CSS responses withhold bytes", async () => {
    for (const details of [{ok: false}, {url: `${url}?other`}, {redirected: true},
        {headers: new Headers()}, {headers: new Headers({"content-type":"text/html"})}]) {
        const {reader} = makeReader({fetch: async () => response(url, details)});
        assert.equal((await reader.read(1, 1, url)).reason, "unusable-stylesheet-response");
    }
});

test("Fetch rejects the source redirect before contacting either destination", async t => {
    const hits = [];
    const server = createServer((request, res) => {
        hits.push(request.url);
        res.writeHead(302, {Location: request.url.includes("allowed") ? "/fixture.css" : "/outside.css"});
        res.end();
    }).listen(0, "127.0.0.1");
    t.after(() => new Promise(resolve => server.close(resolve)));
    await once(server, "listening");
    const origin = `http://127.0.0.1:${server.address().port}`;
    const routes = ["/allowed-redirect.css", "/denied-redirect.css"];
    const {reader} = makeReader({destinations: new Set(routes.map(route => origin + route).concat(`${origin}/fixture.css`)), fetch});
    for (const [index, route] of routes.entries()) {
        assert.equal((await reader.read(index, 1, origin + route)).reason, "read-failed");
    }
    assert.deepEqual(hits, routes);
});

// Drive the packaged entry point's listeners. The browser double supplies sender identities and
// grant answers independently of the messages posted through either end of a port.
const origins = Object.fromEntries(["top", "frame", "resource", "denied"].map(role => [role, `https://${role}.example.test`]));
const drain = () => new Promise(resolve => setImmediate(resolve));
let registerBackground;
function event() {
    const listeners = [];
    return {addListener: fn => listeners.push(fn), fire: (...args) => listeners.map(fn => fn(...args))};
}
function storage(data = {}) {
    return {
        data, get: async k => ({[k]: structuredClone(data[k])}),
        set: async obj => Object.assign(data, structuredClone(obj)), remove: async k => { delete data[k]; },
    };
}

async function boot(t, stores = {}, incognito = false) {
    const granted = Object.fromEntries(Object.keys(origins).map(role => [role, false]));
    const tab = {id: 7, active: true, windowId: 5, incognito, url: `${origins.top}/page.html`};
    const frames = new Map();
    const local = storage(stores.local);
    const session = storage(stores.session);
    const runtime = {id: "probe", getURL: path => `safari-web-extension://probe/${path}`, onConnect: event(), onMessage: event()};
    const safari = {
        runtime, commands: {onCommand: event()},
        tabs: {get: async id => id === tab.id ? {...tab} : undefined, query: async () => [{...tab}],
            onCreated: event(), onRemoved: event(), onReplaced: event(), onActivated: event(), onUpdated: event()},
        permissions: {contains: async ({origins: [pattern]}) => granted[new URL(pattern).hostname.split(".")[0]],
            onAdded: event(), onRemoved: event()},
        extension: {isAllowedIncognitoAccess: async () => true}, storage: {local, session},
        webNavigation: {getAllFrames: async () => [...frames.values()], onBeforeNavigate: event(), onCommitted: event(),
            onHistoryStateUpdated: event(), onReferenceFragmentUpdated: event()},
        alarms: {onAlarm: event(), get: async () => undefined, create: async () => {}},
    };
    t.mock.method(globalThis, "fetch", async address => response(address.href));
    globalThis.__PROBE_ORIGINS__ = origins;
    globalThis.browser = safari;
    t.after(() => { delete globalThis.__PROBE_ORIGINS__; delete globalThis.browser; });
    if (registerBackground) registerBackground(safari);
    else ({registerBackground} = await import("../extension/background.ts"));
    await drain();

    function connect(name, sender) {
        const messages = [];
        const port = {name, sender, messages, closed: false, onMessage: event(), onDisconnect: event(),
            postMessage: msg => messages.push(structuredClone(msg)),
            disconnect() { if (!this.closed) { this.closed = true; this.onDisconnect.fire(this); } },
            last: type => messages.findLast(message => message.type === type)};
        safari.runtime.onConnect.fire(port);
        return port;
    }
    async function editor(sender = {}) {
        const p = connect("probe-editor", {id: runtime.id, url: runtime.getURL("popup.html"), ...sender});
        p.act = async (action, value) => {
            p.onMessage.fire({type: "action", action, value});
            await drain();
            return p.last("state");
        };
        await drain();
        return p;
    }
    let serial = 0;
    async function doc({id = 0, parent = -1, url = tab.url, commit = true, browserId = `doc-${++serial}`,
        registration = "a".repeat(16) + serial.toString(16)} = {}) {
        const frame = {frameId: id, parentFrameId: parent, tabId: tab.id, url, documentId: browserId};
        if (id === 0) tab.url = url;
        if (commit) {
            safari.webNavigation.onBeforeNavigate.fire(frame);
            safari.webNavigation.onCommitted.fire({...frame, transitionQualifiers: []});
        }
        frames.set(id, frame);
        const p = connect("probe-document", {id: runtime.id, tab: {...tab}, frameId: id, documentId: browserId, url, origin: new URL(url).origin});
        p.onMessage.fire({type:"hello", registration});
        p.onMessage.fire({type:"report", inputRevision:1, nativeDark:"light", systemDark:true});
        await drain();
        p.read = async (id, url = `${origins.resource}/css/opaque.css`, revision = p.last("decision")?.revision) => {
            p.onMessage.fire({type:"read", id, revision, url});
            await drain();
            return p.last("read-result");
        };
        return p;
    }
    async function calibrate(e, role) {
        for (const expected of ["deny","allow"]) {
            granted[role] = expected === "allow";
            await e.act("calibrate", {role, expected});
        }
    }
    return {safari, local, session, granted, tab, frames, connect, editor, doc, calibrate};
}

test("background binds popup and document roles to Safari senders and fails closed before calibration", async t => {
    const b = await boot(t);
    assert.equal((await b.editor({id:"foreign"})).closed, true);
    assert.equal((await b.editor({tab:b.tab})).closed, true);
    assert.equal((await b.editor({url:origins.top})).closed, true);
    for (const sender of [{id: "other", tab:b.tab, url:b.tab.url, frameId:0},
        {id:"probe",tab:b.tab,url:"https://unlisted.example.test/page",frameId:0},
        {id:"probe",tab:b.tab,url:b.tab.url,frameId:0,origin:"null"},
        {id:"probe",tab:b.tab,url:b.tab.url}]) {
        assert.equal(b.connect("probe-document", sender).closed, true);
    }
    const doc = await b.doc();
    const e = await b.editor();
    b.granted.top = true;
    let state = await e.act("refresh");
    assert.equal(state.decision.enabled, false);
    await e.act("calibrate", {role:"top",expected:"deny"});
    assert.equal(e.last("state").calibration.at(-1).qualified, false);
    await b.calibrate(e, "top");
    state = await e.act("refresh");
    assert.equal(state.decision.enabled, true);
    assert.equal((await doc.read(1)).ok, false);
    const echo = {type:"probe-echo", id:42, phase:"before-import"};
    assert.equal(b.safari.runtime.onMessage.fire(echo, {id:"other"})[0], undefined);
    const firstEcho = await b.safari.runtime.onMessage.fire(echo, doc.sender)[0];
    assert.equal(firstEcho.receiverCount, 1);
    assert.equal(firstEcho.phase, "before-import");
    assert.equal((await b.safari.runtime.onMessage.fire(echo, doc.sender)[0]).receiverCount, 2);
    doc.onMessage.fire({type:"trace",event:"injected",fields:{readyState:"loading", at:1, url:"private URL"}});
    assert.deepEqual((await e.act("refresh")).observations.findLast(row => row.event === "injected").readyState, "loading");
    assert.ok(!JSON.stringify(e.last("state").observations).includes("private URL"));
    doc.onMessage.fire({type:"trace", event:"candidate-body-delivered", fields:{revision:8, bytes:34, ms:56}});
    doc.onMessage.fire({type:"trace", event:"candidate-load-stage", fields:{mode:"dynamic", asset:"control",
        stage:"import", result:"rejected", errorClass:"TypeError", message:"private URL", url:"private URL"}});
    doc.onMessage.fire({type:"trace", event:"marker-root-style", fields:{result:"unchanged",
        beforeColor:"rgb(24, 35, 50)", expectedColor:"rgb(224, 244, 255)", afterColor:"rgb(24, 35, 50)",
        afterBackground:"private URL"}});
    const observations = (await e.act("refresh")).observations;
    const stage = observations.findLast(row => row.event === "candidate-load-stage");
    assert.deepEqual([stage.mode, stage.asset, stage.stage, stage.result, stage.errorClass],
        ["dynamic", "control", "import", "rejected", "TypeError"]);
    const marker = observations.findLast(row => row.event === "marker-root-style");
    assert.deepEqual([marker.result, marker.beforeColor, marker.expectedColor, marker.afterColor],
        ["unchanged", "rgb(24, 35, 50)", "rgb(224, 244, 255)", "rgb(24, 35, 50)"]);
    assert.ok(!JSON.stringify(observations).includes("private URL"));
    const delivered = observations.findLast(row => row.event === "candidate-body-delivered");
    assert.equal(delivered.bytes,34);
    assert.equal(delivered.revision,8);
    assert.equal(delivered.ms,56);
    assert.equal(observations.findLast(row => row.event === "ordinary-receiver").phase,"before-import");
});

for (const [role, waitAt] of [["top", "grant"], ["top", "frame tree"], ["frame", "frame tree"]]) {
    test(`revoking the ${role} role retires a decision suspended at the ${waitAt} lookup`, {timeout: 3000}, async t => {
        const b = await boot(t);
        const setup = await b.editor();
        await b.calibrate(setup, "top");
        if (role === "frame") await b.calibrate(setup, "frame");
        const top = await b.doc();
        const doc = role === "top" ? top : await b.doc({id:1, parent:0, url:`${origins.frame}/frame.html`});
        const e = await b.editor();
        assert.equal(doc.last("decision").enabled, true);
        const entered = Promise.withResolvers();
        const release = Promise.withResolvers();
        const target = waitAt === "grant" ? b.safari.permissions : b.safari.webNavigation;
        const method = waitAt === "grant" ? "contains" : "getAllFrames";
        const original = target[method];
        let calls = 0;
        const holdCount = role === "frame" ? 2 : 1;
        t.mock.method(target, method, async (...args) => {
            const value = await original(...args);
            if (++calls <= holdCount) {
                if (calls === holdCount) entered.resolve();
                await release.promise;
            }
            return value;
        });
        const evaluating = e.act("renderer", "candidate");
        await entered.promise;
        b.granted[role] = false;
        b.safari.permissions.onRemoved.fire({origins:[`${origins[role]}/*`]});
        const afterRevocation = doc.messages.length - 1;
        assert.equal(doc.last("decision").enabled, false);
        release.resolve();
        await evaluating;
        await drain();
        const decisions = doc.messages.slice(afterRevocation).filter(m => m.type === "decision");
        assert.ok(decisions.length);
        assert.ok(decisions.every(m => !m.enabled && !m.privileged));
        if (role === "frame") assert.equal(top.last("decision").enabled, true);
        assert.equal((await doc.read(19)).ok, false);
        assert.equal(globalThis.fetch.mock.callCount(), 0);
        b.granted[role] = true;
        b.safari.permissions.onAdded.fire({origins:[`${origins[role]}/*`]});
        await drain();
        assert.equal(doc.last("decision").enabled, true);
    });
}

test("background grant pair changes only the resource setting and rejects stale registered senders", async t => {
    const b = await boot(t);
    const e = await b.editor();
    await b.calibrate(e, "top");
    await b.calibrate(e, "resource");
    await e.act("renderer", "candidate");
    const allowed = await b.doc();
    assert.equal(allowed.last("decision").privileged, true);
    assert.deepEqual((await allowed.read(1)).css, css);
    assert.equal((await allowed.read(1)).reason, "invalid-or-replayed-id");
    assert.equal(globalThis.fetch.mock.callCount(), 1);
    b.granted.resource = false;
    b.safari.permissions.onRemoved.fire({origins:[`${origins.resource}/*`]});
    const denied = await b.doc();
    assert.equal(denied.last("decision").privileged, true);
    assert.equal((await denied.read(1)).reason, "grant-or-identity-unavailable");
    assert.equal(globalThis.fetch.mock.callCount(), 1);
    b.granted.resource = true;
    const detached = await b.doc({commit:false});
    assert.equal(detached.last("decision").privileged, false);
    assert.equal((await detached.read(2)).ok, false);
    const stale = await b.doc();
    b.frames.get(0).documentId = "different-document-at-same-url";
    assert.equal((await stale.read(1)).ok, false);
    b.frames.get(0).documentId = stale.sender.documentId;
    b.tab.url = `${origins.frame}/elsewhere`;
    assert.equal((await stale.read(2)).ok, false);
    assert.equal(globalThis.fetch.mock.callCount(), 1);
});

test("current document reports preserve preview and Use My Theme while independent frame grants still apply", async t => {
    const b = await boot(t);
    const calibration = await b.editor();
    await b.calibrate(calibration, "top");
    await b.calibrate(calibration, "frame");
    const doc = await b.doc();
    const child = await b.doc({id:1, parent:0, url:`${origins.frame}/frame.html`});
    const e = await b.editor();
    const report = async (inputRevision, nativeDark, systemDark) => {
        doc.onMessage.fire({type:"report", inputRevision, nativeDark, systemDark});
        await drain();
        return doc.last("decision");
    };
    assert.equal((await report(2, "dark", true)).reason, "native-dark");
    assert.equal(doc.last("decision").inputRevision, 2);
    assert.equal((await report(1, "light", true)).inputRevision, 2);
    await e.act("preview", {scope:"global", fields:{theme:"ocean"}});
    assert.equal(doc.last("decision").reason, "preview");
    assert.equal(child.last("decision").reason, "preview");
    assert.equal(child.last("decision").inputRevision, 1);
    b.granted.frame = false;
    b.safari.permissions.onRemoved.fire({origins:[`${origins.frame}/*`]});
    await drain();
    assert.equal(child.last("decision").enabled, false);
    assert.equal(doc.last("decision").reason, "preview");
    await e.act("discard");
    assert.equal(doc.last("decision").reason, "native-dark");
    await e.act("saved", {scope:"global", fields:{useMyTheme:true}});
    assert.equal(doc.last("decision").reason, "active");
    assert.equal((await report(3, "dark", false)).reason, "system-light");
    assert.equal(doc.last("decision").inputRevision, 3);
    await e.act("saved", {scope:"global", fields:{activation:"on"}});
    assert.equal(doc.last("decision").enabled, true);
    assert.equal(child.last("decision").enabled, false);
});

test("editor previews resolve against current saves and expire on dismissal and same-document navigation", async t => {
    const b = await boot(t);
    const doc = await b.doc();
    const e = await b.editor();
    await b.calibrate(e, "top");
    const initial = (await e.act("saved", {scope:"page", fields:{linkColor:"#337733", activation:"off"}})).savedRevision;
    let state = await e.act("preview", {scope:"host", fields:{theme:"ocean",linkColor:"#ccaabb"}});
    assert.equal(state.decision.enabled, true);
    assert.equal(state.decision.appearance.linkColor, "#337733");
    assert.equal(state.decision.appearance.theme, "ocean");
    state = await e.act("saved", {scope:"global",fields:{brightness:76}});
    assert.equal(state.savedRevision, initial + 1);
    assert.equal(state.decision.appearance.brightness, 76);
    state = await e.act("preview", {scope:"page",fields:{linkColor:null}});
    assert.equal(state.decision.appearance.theme, "ocean");
    assert.equal(state.decision.appearance.linkColor, "#62d2ed");
    b.safari.webNavigation.onHistoryStateUpdated.fire({tabId:b.tab.id,frameId:0,url:b.tab.url});
    assert.ok((await e.act("refresh")).preview);
    const url = `${b.tab.url}#next`;
    b.frames.get(0).url = b.tab.url = url;
    b.safari.webNavigation.onReferenceFragmentUpdated.fire({tabId:b.tab.id,frameId:0,url});
    state = await e.act("refresh");
    assert.equal(state.preview, null);
    assert.equal(state.decision.reason, "saved-off");
    await e.act("preview",{scope:"host",fields:{theme:"ocean"}});
    assert.equal(e.last("error").reason, "open-editor-on-fixture");
    const newer = await b.editor();
    await newer.act("preview", {scope:"page",fields:{theme:"ocean"}});
    e.disconnect();
    assert.ok((await newer.act("refresh")).preview);
    newer.disconnect();
    await drain();
    assert.equal(doc.last("decision").reason, "saved-off");
});

test("nested frame reads require actual ancestor grants, current parents and independently variable resource permission", async t => {
    const b = await boot(t);
    const e = await b.editor();
    await b.calibrate(e, "top");
    await b.calibrate(e, "frame");
    await b.calibrate(e, "denied");
    await b.calibrate(e, "resource");
    await e.act("renderer","candidate");
    await b.doc();
    await b.doc({id:3,parent:0,url:`${origins.frame}/frame.html`});
    const nested = await b.doc({id:5,parent:3,url:`${origins.denied}/frame.html`});
    assert.equal((await nested.read(1)).css, css);
    b.granted.frame = false;
    assert.equal((await nested.read(2)).ok, false);
    b.granted.frame = true;
    b.frames.delete(3);
    assert.equal((await nested.read(3)).ok, false);
    b.safari.webNavigation.onBeforeNavigate.fire({tabId:b.tab.id,frameId:3});
    assert.equal(nested.closed, true);
    assert.equal(globalThis.fetch.mock.callCount(), 1);
});

test("pause aborts an in-flight read, rejects its reply and survives a new background", async t => {
    const b = await boot(t);
    let e = await b.editor();
    await b.calibrate(e, "top");
    await b.calibrate(e, "resource");
    await e.act("renderer", "candidate");
    const d = await b.doc();
    e = await b.editor(); // Navigation ended the calibration popup session.
    const gate = Promise.withResolvers();
    globalThis.fetch.mock.mockImplementation(() => gate.promise);
    d.onMessage.fire({type:"read", id:1, url:`${origins.resource}/css/gated.css`, revision:d.last("decision").revision});
    await drain();
    const [,init] = globalThis.fetch.mock.calls[0].arguments;
    assert.equal(init.signal.aborted,false);
    await e.act("pause",true);
    assert.equal(init.signal.aborted,true);
    gate.resolve(response(`${origins.resource}/css/gated.css`));
    await drain();
    assert.equal(d.last("read-result").ok,false);
    const next = await boot(t,{local:b.local.data,session:b.session.data});
    e = await next.editor();
    assert.equal(e.last("state").paused,true);
    next.safari.commands.onCommand.fire("toggle-pause");
    await drain();
    assert.equal((await e.act("refresh")).paused,false);
});

test("session records require the same live document and cannot replay into a duplicated or restored tab", async t => {
    const a = await boot(t);
    const d = await a.doc({browserId:"original"});
    const e = await a.editor();
    await e.act("override","on");
    assert.equal(e.last("state").override, "on");
    assert.deepEqual(a.local.data, {});
    const stores = {session:structuredClone(a.session.data)};
    const b = await boot(t, stores);
    await b.doc({browserId:d.sender.documentId,commit:false});
    assert.equal((await b.editor()).last("state").override, "on");
    b.tab.id++;
    b.safari.tabs.onCreated.fire(b.tab);
    await b.doc({browserId:"duplicate"});
    assert.equal((await b.editor()).last("state").override,null);
    const c = await boot(t, {session:structuredClone(a.session.data)});
    await c.doc({browserId:"new-document",commit:false,registration:"9".repeat(32)});
    assert.equal((await c.editor()).last("state").override,null);
});

test("private visits and unsaved drafts leave durable settings alone and require private execution", async t => {
    const a = await boot(t);
    await a.doc();
    const ordinary = await a.editor();
    await ordinary.act("saved",{scope:"host",fields:{theme:"ocean"}});
    const before = structuredClone(a.local.data);
    const b = await boot(t,{local:a.local.data},true);
    await b.doc();
    const privateEditor = await b.editor();
    await b.calibrate(privateEditor,"top");
    assert.equal(privateEditor.last("state").decision.appearance.theme,"ocean");
    await privateEditor.act("preview",{scope:"host",fields:{theme:"graphite"}});
    await privateEditor.act("saved",{scope:"global",fields:{theme:"graphite"}});
    assert.equal(privateEditor.last("error").reason,"private-save-unavailable");
    assert.deepEqual(b.local.data,before);
    b.safari.extension.isAllowedIncognitoAccess = async () => false;
    assert.equal((await privateEditor.act("refresh")).decision.enabled,false);
    privateEditor.disconnect();
    await drain();
    assert.deepEqual(b.local.data,before);
});

test("commands and popup actions keep temporary activation separate from saved settings", async t => {
    const b = await boot(t);
    await b.doc();
    let e = await b.editor();
    await b.calibrate(e, "top");
    let state = await e.act("saved", {scope:"global", fields:{activation:"off"}});
    const savedRevision = state.savedRevision;
    b.safari.commands.onCommand.fire("toggle-tab");
    await drain();
    state = await e.act("refresh");
    assert.equal(state.decision.enabled,true);
    assert.equal(state.override,"on");
    assert.equal(state.savedRevision,savedRevision);
    await b.doc({url:`${origins.top}/next/page.html`});
    assert.equal(e.last("state").override,"on");
    e = await b.editor();
    await e.act("override","restore");
    assert.equal(e.last("state").decision.reason,"saved-off");
    await e.act("override","on");
    await b.doc({url:`${origins.frame}/page.html`});
    await b.doc({url:`${origins.top}/page.html`});
    e = await b.editor();
    assert.equal(e.last("state").override,null);
    assert.equal(e.last("state").savedRevision,savedRevision);
    await e.act("access","refreshing-unknown");
    assert.equal(e.last("state").decision.reason,"access-unknown");
    await e.act("access","refreshing-valid");
    assert.equal(e.last("state").decision.reason,"saved-off");
    const schedule = {days:[5],start:"22:00",end:"07:00"};
    state = await e.act("schedule",schedule);
    assert.deepEqual(state.schedule,schedule);
    await e.act("schedule",{...schedule,end:schedule.start});
    assert.equal(e.last("error").reason,"invalid-schedule");
    b.safari.alarms.onAlarm.fire({name:"wall-time"});
    await drain();
    assert.ok(e.last("state").observations.some(row => row.event === "wall-time-alarm"));
});

test("a permission notification aborts pending transport and immediately disables the old decision", async t => {
    const b = await boot(t);
    const e = await b.editor();
    await b.calibrate(e,"top");
    await b.calibrate(e,"resource");
    await e.act("renderer","candidate");
    const d = await b.doc();
    const hold = Promise.withResolvers();
    globalThis.fetch.mock.mockImplementation(() => hold.promise);
    const old = d.last("decision").revision;
    d.onMessage.fire({type:"read", id:1, revision:old, url:`${origins.resource}/css/gated.css`});
    await drain();
    b.granted.top = false;
    b.safari.permissions.onRemoved.fire({origins:[permissionPattern(origins.top)]});
    assert.equal(d.last("decision").enabled,false);
    assert.ok(d.last("decision").revision > old);
    assert.equal(globalThis.fetch.mock.calls[0].arguments[1].signal.aborted,true);
    hold.resolve(response(`${origins.resource}/css/gated.css`));
    await drain();
    assert.equal(d.last("read-result").ok,false);
    assert.equal(d.last("decision").reason,"permission");
});

test("an isolated-world registration can corroborate session continuity when sender.documentId is absent", async t => {
    const first = await boot(t);
    await first.doc({browserId:null,registration:"1".repeat(32)});
    const e = await first.editor();
    await e.act("override","off");
    const stores = {session:structuredClone(first.session.data)};
    const second = await boot(t,stores);
    await second.doc({browserId:null,registration:"1".repeat(32),commit:false});
    assert.equal((await second.editor()).last("state").override,"off");
    const third = await boot(t,stores);
    await third.doc({browserId:null,registration:"2".repeat(32),commit:false});
    assert.equal((await third.editor()).last("state").override,null);
});

test("switching tabs closes the old edit and cannot re-arm the old document's privileged reader", async t => {
    const b = await boot(t);
    const initial = await b.editor();
    await b.calibrate(initial,"top");
    await b.calibrate(initial,"resource");
    await initial.act("renderer","candidate");
    const d = await b.doc();
    const e = await b.editor();
    await e.act("preview",{scope:"host",fields:{theme:"ocean"}});
    b.safari.tabs.onActivated.fire({tabId:23,windowId:5});
    await drain();
    assert.equal(e.last("state").preview,null);
    assert.equal(d.last("decision").privileged,false);
    await e.act("saved",{scope:"host",fields:{theme:"ocean"}});
    assert.equal(e.last("error").reason,"open-editor-on-fixture");
    assert.equal((await d.read(1)).ok,false);
    assert.equal(globalThis.fetch.mock.callCount(),0);
});

test("unavailable permission and frame APIs leave the current document inactive", async t => {
    const b = await boot(t);
    const d = await b.doc();
    const e = await b.editor();
    await b.calibrate(e,"top");
    await b.calibrate(e,"resource");
    await e.act("renderer","candidate");
    const fresh = await b.doc();
    assert.equal(fresh.last("decision").privileged,true);
    b.safari.permissions.contains = async () => { throw Error("permission API unavailable"); };
    const state = await e.act("refresh");
    assert.equal(state.grants.top,null);
    assert.equal(state.decision.reason,"permission");
    assert.equal((await fresh.read(1)).ok,false);
    assert.equal(globalThis.fetch.mock.callCount(),0);
    assert.equal(d.closed,true);
    b.safari.permissions.contains = async () => true;
    b.safari.webNavigation.getAllFrames = async () => null;
    assert.equal((await e.act("refresh")).decision.enabled,false);
});

test("corrupt durable inputs cannot enable a schedule or resume rendering", async t => {
    const key = "safari-capability-settings-v1";
    const saved = {revision:5, defaults:{activation:"schedule"},rules:[]};
    const local = {[key]:{paused:false,renderer:"marker",access:"valid",
        schedule:{weekdays:[5],start:"22:00",end:"22:00"},saved}};
    const b = await boot(t,{local});
    await b.doc();
    const e = await b.editor();
    await b.calibrate(e,"top");
    assert.equal(e.last("state").decision.reason,"outside-schedule");
    for (const malformed of [{...saved,revision:-1},{...saved,rules:[null]},
        {...saved,defaults:{activation:"unexpected"}},
        {...saved,rules:[{scope:{kind:"host",hostname:"unrelated.test"},values:{theme:"ocean"}}]}]) {
        const c = await boot(t,{local:{[key]:{...local[key],saved:malformed}}});
        await c.doc();
        const popup = await c.editor();
        await c.calibrate(popup,"top");
        assert.equal(popup.last("state").paused,true);
        assert.equal(popup.last("state").decision.enabled,false);
    }
});

test("discard reveals the latest saved settings, including scope-specific removals", async t => {
    const b = await boot(t);
    await b.doc({url:`${origins.top}/next/page.html`});
    const e = await b.editor();
    await b.calibrate(e,"top");
    await e.act("saved",{scope:"domain",fields:{useMyTheme:true,brightness:80}});
    await e.act("saved",{scope:"section",fields:{appearance:"custom",linkColor:"#554477"}});
    await e.act("preview",{scope:"page",fields:{appearance:"adaptive",linkColor:"#abcdef"}});
    assert.equal(e.last("state").decision.appearance.theme,"graphite");
    await e.act("saved",{scope:"section",fields:{linkColor:null}});
    const latest = await e.act("discard");
    assert.equal(latest.preview,null);
    assert.equal(latest.decision.appearance.theme,"ocean");
    assert.equal(latest.decision.appearance.brightness,80);
    assert.equal(latest.decision.appearance.linkColor,"#62d2ed");
    const c = await boot(t,{local:b.local.data});
    await c.doc({url:`${origins.top}/next/page.html`});
    const afterRestart = await c.editor();
    await c.calibrate(afterRestart,"top");
    assert.deepEqual(afterRestart.last("state").decision.appearance,latest.decision.appearance);
});

test("document_start may connect before Safari commits a navigation without native document IDs", async t => {
    const b = await boot(t);
    const e = await b.editor();
    await b.calibrate(e,"top");
    await b.calibrate(e,"resource");
    await e.act("renderer","candidate");
    const destination = {tabId:b.tab.id, frameId:0, url:b.tab.url};
    b.safari.webNavigation.onBeforeNavigate.fire(destination);
    const d = await b.doc({browserId:null,commit:false});
    assert.equal(d.last("decision").enabled,false);
    assert.equal((await d.read(1)).ok,false);
    b.safari.webNavigation.onCommitted.fire({...destination, transitionQualifiers:[]});
    await drain();
    assert.equal(d.closed,false);
    assert.equal(d.last("decision").privileged,true);
    assert.equal((await d.read(2)).css,css);
});

test("a replaced popup cannot observe, discard, or save over its successor's draft", async t => {
    const b = await boot(t);
    await b.doc();
    const old = await b.editor();
    const current = await b.editor();
    await current.act("preview", {scope: "host", fields: {theme: "ocean"}});
    assert.ok(current.last("state").preview);
    assert.equal(old.last("state").preview, null);
    for (const [action, value] of [
        ["discard", undefined], ["pause", true], ["renderer", "candidate"], ["access", "inactive"],
        ["calibrate", {role: "resource", expected: "allow"}],
        ["schedule", {days: [1], start: "21:00", end: "06:00"}],
        ["saved", {scope: "host", fields: {activation: "off"}}],
    ]) {
        await old.act(action, value);
        assert.equal(old.last("error").reason, "open-editor-on-fixture");
    }
    await current.act("refresh");
    assert.equal(current.last("state").preview.edits.theme, "ocean");
});
