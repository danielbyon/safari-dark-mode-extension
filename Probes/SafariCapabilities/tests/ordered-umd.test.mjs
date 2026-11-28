import assert from "node:assert/strict";
import { test } from "node:test";
import { auditedFiles } from "../scripts/build.mjs";
import { compareOrdered } from "../scripts/compare-ordered.mjs";

for (const activation of [true, false]) {
    test(`manifest-ordered classic UMD runs with fixture activation ${activation ? "on" : "off"}`, async () => {
        const run = await compareOrdered(activation);
        assert.equal(run.siteGrant, "assumed");
        assert.equal(run.runAt, "document_start");
        assert.deepEqual(run.scripts, ["before.js", "darkreader.js", "after.js"]);
        assert.equal(run.umdSHA256, auditedFiles["darkreader.js"]);
        assert.equal(run.apiBeforeList, "undefined");
        assert.equal(run.publicAPI, true);
        assert.equal(run.enabledAfterList, false);

        const phases = activation ? ["before-import", "after-import", "after-disable"] : ["before-import", "after-import"];
        assert.deepEqual(run.received, phases.map((phase, index) => ({id: index + 1, phase, receiverCount: 1})));
        assert.deepEqual(run.messages.map(({id, phase, returned, reply, replyReceiverCount}) =>
            [id, phase, returned, reply, replyReceiverCount]), phases.map((phase, index) => index === 0
            ? [1, phase, "promise", "echoed", 1] : [index + 1, phase, "undefined", "unavailable", undefined]));
        if (activation) {
            assert.equal(run.enable.call, "returned");
            assert.equal(run.enable.isEnabled, true);
            assert.equal(run.fallbackStyleAfterEnable, true);
            assert.equal(run.disable.call, "returned");
            assert.equal(run.disable.isEnabled, false);
            assert.equal(run.fallbackStyleAfterDisable, false);
        } else {
            assert.equal(run.enable, undefined);
            assert.equal(run.disable, undefined);
        }
    });
}
