import { captureNativeDark, type NativeAppearance } from "./native-dark.ts";
import { CandidateReads, FrameRenderer, effectSample, type Candidate, type RenderInput, type Trace } from "./renderer.ts";
import { fixtureOrigins } from "./fixture-config.ts";

type Phase = "before-import" | "after-import" | "after-disable";
type Observation = { event: string; ms: number; fields?: Parameters<Trace>[1] };
type World = typeof globalThis & {
    DarkReader?: Candidate;
    chrome?: { runtime?: { sendMessage(message: unknown): unknown } };
    safariProbeObservations?: () => Observation[];
};

const world = globalThis as World;
const injectedAt = performance.now();
const injectedState = document.readyState;
// Match patterns cannot distinguish ports. Keep the content probe on the configured origins.
if ([fixtureOrigins.top, fixtureOrigins.frame, fixtureOrigins.denied].includes(location.origin)) start();

function start() {
    const records: Observation[] = [];
    const registration = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
    const system = matchMedia("(prefers-color-scheme: dark)");
    let port: browser.runtime.Port | undefined;
    let decision: RenderInput | undefined;
    let observedURL = location.href;
    let appearance: NativeAppearance | undefined;
    let detect: (() => NativeAppearance) | undefined;
    let systemDark = system.matches;
    let serial = 0;
    let registered = false;
    let importing: Promise<void> | undefined;
    let baseline = "";
    let generation = 0;
    let parked = false;

    const trace: Trace = (event, fields) => {
        const record = { event, ms: Math.round(performance.now()), fields };
        records.push(record);
        if (records.length > 256) records.shift();
        post({ type: "trace", event, fields: { ms: record.ms, ...fields } });
    };
    // The inspector can read the document's last observations after a port disconnect.
    world.safariProbeObservations = () => records.map(row => ({ ...row, fields: { ...row.fields } }));

    function post(message: unknown) {
        try { port?.postMessage(message); } catch { /* A disconnect can precede its notification. */ }
    }

    function probeMessage(phase: Phase) {
        const runtime = world.chrome?.runtime;
        if (!runtime?.sendMessage) {
            trace("ordinary-message", { phase, returned: "unavailable" });
            return;
        }
        try {
            const id = ++serial;
            const result = runtime.sendMessage({ type: "probe-echo", id, phase });
            const promise = result != null && typeof (result as Promise<unknown>).then === "function";
            trace("ordinary-message", { phase, id, returned: promise ? "promise" : typeof result });
            if (promise) void Promise.resolve(result).then(reply => {
                const response = reply as Record<string, unknown> | null;
                trace("ordinary-reply", { phase, id, echoed: response?.type === "probe-echo" && response.id === id && response.phase === phase,
                    receiverCount: typeof response?.receiverCount === "number" ? response.receiverCount : null });
            }, () => trace("ordinary-reply-rejected", { phase }));
        } catch {
            trace("ordinary-message", { phase, returned: "threw" });
        }
    }

    type Pending = { revision: number; finish: (result?: string) => void };
    const pending = new Map<number, Pending>();
    const reads = new CandidateReads((url, revision, signal) => new Promise((resolve, reject) => {
        if (!port || signal.aborted) { reject(new Error("Document port unavailable")); return; }
        const id = ++serial;
        const finish = (css?: string) => {
            pending.delete(id);
            signal.removeEventListener("abort", abort);
            if (css === undefined) reject(new Error("Stylesheet unavailable"));
            else resolve(css);
        };
        const abort = () => { trace("content-read-invalidated", { id, revision }); finish(); };
        pending.set(id, { revision, finish });
        signal.addEventListener("abort", abort, { once: true });
        try { port.postMessage({ type: "read", id, revision, url }); }
        catch { finish(); }
    }), revision => Boolean(port && decision?.enabled && decision.privileged && decision.revision === revision &&
        location.href === observedURL && system.matches === systemDark && detect?.().scheme === appearance?.scheme), trace);
    const renderer = new FrameRenderer(document, reads, trace, () => probeMessage("after-disable"));

    function candidateReady() {
        if (registered) return;
        if (!world.DarkReader) throw new Error("Packaged UMD did not register in the content world");
        renderer.register(world.DarkReader);
        registered = true;
        probeMessage("after-import");
    }

    function beginImport() {
        // A packaged module runs in this isolated world. Safari builds that reject
        // the load produce an import failure in the observations.
        if (!importing) {
            probeMessage("before-import");
            importing = import(browser.runtime.getURL("darkreader.js")).then(candidateReady);
        }
        return importing;
    }

    function sampleEffects(source: string, always = false) {
        if (!registered && !always) return;
        const sample = effectSample(document);
        const signature = JSON.stringify(sample);
        if (always || signature !== baseline) {
            baseline = signature;
            trace("render-effects", { source, generation, eligible: decision?.enabled === true, ...sample });
        }
    }
    function candidateMutation(records: MutationRecord[]) {
        function belongs(node: Node) {
            const element = node.nodeType === 1 ? node as Element : node.parentElement;
            return Boolean(element?.closest("style.darkreader, link.darkreader"));
        }
        return records.some(change => belongs(change.target) ||
            change.attributeName?.startsWith("data-darkreader-") ||
            [...change.addedNodes, ...change.removedNodes].some(belongs));
    }
    const observer = new MutationObserver(changes => {
        if (registered && candidateMutation(changes)) {
            trace("candidate-dom-mutation", { generation, eligible: decision?.enabled === true });
            sampleEffects("mutation");
        }
        refreshInputs("mutation");
    });
    function transition(next?: RenderInput) {
        // Drain synchronous old-generation records before drawing the time boundary.
        if (registered && candidateMutation(observer.takeRecords())) sampleEffects("before-decision", true);
        generation++;
        const expected = generation;
        decision = next;
        try { renderer.disable(); }
        catch { trace("teardown-error", { generation }); }
        observer.takeRecords();
        if (registered) sampleEffects("after-teardown", true);
        if (!next?.enabled) return;
        const apply = () => {
            if (expected !== generation || decision !== next || !port) return;
            refreshInputs("poll");
            if (expected !== generation || decision !== next) return;
            try { renderer.apply(next); } catch { trace("render-error", { generation }); }
            observer.takeRecords();
            sampleEffects("after-apply", true);
        };
        if (next.renderer === "candidate" && !registered) {
            void beginImport().then(apply, () => trace("candidate-import-failed", { generation: expected }));
        } else apply();
    }

    function refreshInputs(trigger: string, force = false) {
        if (!detect) return;
        if (observedURL !== location.href) {
            // A same-document URL change ends the preview. Reconnect so a reply
            // already queued on the old port cannot render the previous path.
            observedURL = location.href;
            const previous = port;
            port = undefined;
            transition();
            previous?.disconnect();
            connect();
            return;
        }
        const result = detect();
        const changed = appearance?.scheme !== result.scheme || appearance.reason !== result.reason ||
            systemDark !== system.matches;
        const invalidates = (appearance?.scheme === "dark") !== (result.scheme === "dark") ||
            (window === window.top && systemDark !== system.matches);
        if (trigger !== "poll" || changed) trace("native-dark-read", { trigger, ...result });
        if (changed || force) {
            appearance = result;
            systemDark = system.matches;
            if (invalidates) transition();
            post({ type: "report", nativeDark: result.scheme, systemDark });
        }
    }
    function connect() {
        if (port || parked) return;
        try {
            const current = browser.runtime.connect({ name: "probe-document" });
            port = current;
            type FrameMessage = ({type: "decision"; instance: string; reason: string} & RenderInput)
                | {type: "read-result"; revision: number; id: number; ok: boolean; css?: string};
            let lastRevision = -1;
            current.onMessage.addListener(raw => {
                const message = raw as FrameMessage;
                if (port !== current) return;
                if (message.type === "decision") {
                    if (!detect || !Number.isSafeInteger(message.revision)) return;
                    if (lastRevision >= message.revision) return;
                    lastRevision = message.revision;
                    trace("content-decision", { revision: message.revision, enabled: message.enabled, privileged: message.privileged });
                    transition(message);
                } else if (message.type === "read-result") {
                    const request = pending.get(message.id);
                    if (request && request.revision === message.revision) {
                        request.finish(message.ok && typeof message.css === "string" ? message.css : undefined);
                    }

                }
            });
            current.onDisconnect.addListener(() => {
                if (port !== current) return;
                port = undefined;
                transition();
                trace("document-disconnected");
            });
            post({ type: "hello", registration });
            trace("injected", { at: injectedAt, readyState: injectedState, top: window === window.top });
            refreshInputs("connect", true);
        } catch { port = undefined; trace("document-port-unavailable"); }
    }

    connect();
    function ready() {
        const pendingSheets = [...document.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]')]
            .some(link => !link.disabled && !link.sheet);
        if (pendingSheets && document.readyState !== "complete") {
            window.addEventListener("load", ready, { once: true });
            return;
        }
        detect = captureNativeDark(document.styleSheets, query => matchMedia(query).matches, pendingSheets);
        observer.observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
        refreshInputs("document-ready", true);
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready, { once: true });
    else ready();
    // CSSOM edits and pushState do not necessarily trigger a DOM mutation.
    setInterval(() => {
        if (parked || document.hidden) return;
        refreshInputs("poll");
        sampleEffects("poll");
    }, 500);
    system.addListener(() => refreshInputs("system"));
    window.addEventListener("popstate", () => refreshInputs("history"));
    window.addEventListener("hashchange", () => refreshInputs("hash"));
    window.addEventListener("pagehide", () => {
        parked = true;
        const current = port;
        port = undefined;
        transition();
        current?.disconnect();
    });
    window.addEventListener("pageshow", () => { parked = false; connect(); });
    window.addEventListener("focus", connect);
    window.addEventListener("pointerdown", connect, { capture: true });
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) { connect(); refreshInputs("visible"); }
    });
}
