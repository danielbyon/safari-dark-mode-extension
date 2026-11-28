import assert from "node:assert/strict";
import test from "node:test";

for (const input of ["native-dark", "system"]) {
    test(`a queued decision cannot undo local ${input} invalidation before the new decision arrives`, async t => {
        const messages = [];
        const styles = new Set();
        let deliver;
        let scheme = "light";
        let onSystemChange;
        let onMutation;
        const media = {matches:true, addListener(fn) { onSystemChange = fn; }};
        const win = new EventTarget();
        win.top = win;
        const sheet = {media:{mediaText:""}, cssRules:[{type:1, selectorText:":root",
            style:{getPropertyValue:() => scheme}}]};
        const doc = Object.assign(new EventTarget(), {
            readyState:"complete", styleSheets:[sheet], querySelectorAll:() => [], querySelector:() => null,
            head:{append:node => styles.add(node)}, createElement() {
                const node = {remove:() => styles.delete(node), style:{}};
                return node;
            },
        });
        const runtime = {connect:() => ({
            onMessage:{addListener:fn => { deliver = fn; }}, onDisconnect:{addListener() {}},
            postMessage:m => messages.push(m),
        })};
        const globals = {browser:{runtime}, window:win, document:doc, location:new URL("http://127.0.0.1:8787/page.html"),
            matchMedia:() => media, MutationObserver:class {
                constructor(fn) { onMutation = fn; }
                observe() {} takeRecords() { return []; }
            }};
        Object.assign(globalThis, globals);
        t.mock.method(globalThis, "setInterval", () => 0);
        t.after(() => {
            for (const key of [...Object.keys(globals), "safariProbeObservations"]) delete globalThis[key];
        });
        await import(`../extension/content.ts?input=${input}`);
        const report = () => messages.findLast(m => m.type === "report");
        const prior = report();
        const enabled = {type:"decision", renderer:"marker", reason:"active", enabled:true, privileged:false,
            fix:true, instance:"test", inputRevision:prior.inputRevision, revision:1,
            appearance:{mode:"adaptive", theme:"graphite", brightness:100, linkColor:"#123456"}};
        deliver(enabled);
        assert.equal(styles.size, 1);
        if (input === "native-dark") { scheme = "dark"; onMutation([]); }
        else { media.matches = false; onSystemChange(); }
        const current = report();
        assert.equal(styles.size, 0);
        assert.equal(current.nativeDark, input === "native-dark" ? "dark" : "light");
        assert.equal(current.systemDark, input === "native-dark");
        const applied = () => messages.filter(m => m.event === "marker-inserted").length;
        deliver({...enabled, revision:2});
        assert.equal(styles.size, 0, "an obsolete enable must never reinsert the marker");
        assert.equal(applied(), 1, "no intervening marker application");
        assert.ok(current.inputRevision > prior.inputRevision);
        deliver({...enabled, revision:3, inputRevision:current.inputRevision, enabled:false, fix:false, reason:input});
        assert.equal(styles.size, 0);
        // The current background decision can permit an explicit preview or a saved On rule.
        deliver({...enabled, revision:4, inputRevision:current.inputRevision, reason:input === "native-dark" ? "preview" : "active"});
        assert.equal(styles.size, 1);
    });
}
