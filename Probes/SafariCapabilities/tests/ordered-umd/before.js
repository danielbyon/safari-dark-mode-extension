// Each send looks up the current function in the same classic-script world as the UMD.
globalThis.offlineProbe.send = phase => {
    const id = globalThis.offlineProbe.messages.length + 1;
    const row = {id, phase, returned: "threw", reply: "unavailable"};
    globalThis.offlineProbe.messages.push(row);
    try {
        const response = globalThis.chrome.runtime.sendMessage({type: "probe-echo", phase, id});
        row.returned = typeof response?.then === "function" ? "promise" : typeof response;
        if (row.returned === "promise") {
            globalThis.offlineProbe.pending.push(response.then(reply => {
                row.reply = reply.type === "probe-echo" && reply.phase === phase && reply.id === id ? "echoed" : "mismatched";
                row.replyReceiverCount = reply.receiverCount;
            }, () => { row.reply = "rejected"; }));
        }
    } catch { /* The row preserves a synchronous throw. */ }
};
globalThis.offlineProbe.apiBeforeList = typeof globalThis.DarkReader;
globalThis.offlineProbe.send("before-import");
