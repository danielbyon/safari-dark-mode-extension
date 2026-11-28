{
    const probe = globalThis.offlineProbe;
    const candidate = globalThis.DarkReader;
    probe.publicAPI = Boolean(candidate && ["enable", "disable", "isEnabled", "setFetchMethod"].every(
        name => typeof candidate[name] === "function"));
    if (probe.publicAPI) probe.enabledAfterList = candidate.isEnabled();
    probe.send("after-import");
    if (probe.publicAPI && probe.activation) {
        try {
            candidate.enable();
            probe.enable = {call: "returned", isEnabled: candidate.isEnabled()};
        } catch {
            probe.enable = {call: "threw", isEnabled: candidate.isEnabled()};
        }
        probe.fallbackStyleAfterEnable = Boolean(document.querySelector(".darkreader--fallback")?.textContent);
        try {
            candidate.disable();
            probe.disable = {call: "returned", isEnabled: candidate.isEnabled()};
            probe.send("after-disable");
        } catch {
            probe.disable = {call: "threw", isEnabled: candidate.isEnabled()};
        }
        probe.fallbackStyleAfterDisable = Boolean(document.querySelector(".darkreader--fallback")?.textContent);
    }
}
