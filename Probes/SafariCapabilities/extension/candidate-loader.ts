import type { Candidate, Trace } from "./renderer.ts";

export type MessagePhase = "before-import" | "after-import" | "after-disable";
type Mode = "dynamic" | "ordered-preflight";
type Asset = "control" | "candidate";

export const candidateLoadTrace = {
    mode: ["dynamic", "ordered-preflight"],
    asset: ["control", "candidate"],
    stage: ["eligibility", "ordered-preflight", "url", "import", "evaluation", "world", "api", "register"],
    result: ["expired", "present", "missing", "blocked-eager-umd", "resolved", "requested", "rejected",
        "completed", "started", "unobserved", "preexisting", "available", "incomplete", "registered", "threw"],
    errorClass: ["TypeError", "SyntaxError", "ReferenceError", "SecurityError", "AbortError", "Other"],
} as const;

type Stage = typeof candidateLoadTrace.stage[number];
type Result = typeof candidateLoadTrace.result[number];
type ErrorClass = typeof candidateLoadTrace.errorClass[number];

declare const __PROBE_LOADER_MODE__: Mode;
type LoaderOptions = {
    getURL: (asset: string) => string;
    getCandidate: () => unknown;
    register: (candidate: Candidate) => void;
    trace: Trace;
    ordinary: (phase: MessagePhase) => void;
};

export function candidateErrorClass(error: unknown): ErrorClass {
    // A rejected import may include the private extension URL in its message.
    const name = error instanceof Error || error instanceof DOMException ? error.name : undefined;
    return candidateLoadTrace.errorClass.find(value => value === name) ?? "Other";
}

function hasAPI(value: unknown): value is Candidate {
    if (!value || typeof value !== "object") return false;
    const api = value as Partial<Candidate>;
    return typeof api.enable === "function" && typeof api.disable === "function" &&
        typeof api.isEnabled === "function" && typeof api.setFetchMethod === "function";
}

/** One loader belongs to one content world. Each caller supplies its own live eligibility check. */
export function createCandidateLoader({getURL, getCandidate, register, trace, ordinary}: LoaderOptions) {
    const mode: Mode = typeof __PROBE_LOADER_MODE__ === "undefined" ? "dynamic" : __PROBE_LOADER_MODE__;
    let controlStarted = false;
    let candidate: Promise<Candidate | undefined> | undefined;
    let registered = false;
    let registrationFailed = false;
    let orderedObserved = false;

    function record(revision: number, asset: Asset, stage: Stage, result: Result, failure?: ErrorClass) {
        trace("candidate-load-stage", { revision, mode, asset, stage, result, ...(failure && {errorClass: failure}) });
    }

    function resolve(revision: number, asset: Asset, path: string) {
        try {
            const url = getURL(path);
            new URL(url); // A malformed result fails before the module loader sees it.
            record(revision, asset, "url", "resolved");
            return url;
        } catch (error) {
            record(revision, asset, "url", "threw", candidateErrorClass(error));
            return undefined;
        }
    }

    async function runControl(revision: number) {
        const url = resolve(revision, "control", "packaged-control.mjs");
        if (!url) return;
        record(revision, "control", "import", "requested");
        let module: {controlWorld?: unknown};
        try {
            module = await import(url);
        } catch (error) {
            record(revision, "control", "import", "rejected", candidateErrorClass(error));
            record(revision, "control", "evaluation", "unobserved");
            return;
        }
        record(revision, "control", "import", "resolved");
        record(revision, "control", "evaluation", "completed");
        record(revision, "control", "world", module.controlWorld === globalThis ? "present" : "missing");
    }

    async function importCandidate(revision: number) {
        ordinary("before-import");
        const url = resolve(revision, "candidate", "darkreader.js");
        if (!url) return;
        if (getCandidate() !== undefined) {
            record(revision, "candidate", "world", "preexisting");
            return;
        }
        record(revision, "candidate", "import", "requested");
        try {
            await import(url);
        } catch (error) {
            record(revision, "candidate", "import", "rejected", candidateErrorClass(error));
            // The pinned UMD assigns globalThis.DarkReader before calling its factory.
            // A fresh export is evidence that its body started even if the factory threw.
            const started = getCandidate() !== undefined;
            record(revision, "candidate", "evaluation", started ? "started" : "unobserved");
            record(revision, "candidate", "world", started ? "present" : "unobserved");
            if (started) ordinary("after-import");
            return;
        }
        record(revision, "candidate", "import", "resolved");
        record(revision, "candidate", "evaluation", "completed");
        ordinary("after-import");
        const value = getCandidate();
        record(revision, "candidate", "world", value === undefined ? "missing" : "present");
        if (value === undefined) return;
        if (!hasAPI(value)) {
            record(revision, "candidate", "api", "incomplete");
            return;
        }
        record(revision, "candidate", "api", "available");
        return value;
    }

    function current(revision: number, isCurrent: () => boolean) {
        if (isCurrent()) return true;
        record(revision, "candidate", "eligibility", "expired");
        return false;
    }

    return {
        async load(revision: number, isCurrent: () => boolean): Promise<boolean> {
            if (!current(revision, isCurrent)) return false;
            if (mode === "ordered-preflight") {
                if (orderedObserved) return false;
                orderedObserved = true;
                ordinary("before-import");
                const preflight = (globalThis as typeof globalThis & {safariProbeOrderedPreflight?: boolean})
                    .safariProbeOrderedPreflight === true;
                record(revision, "control", "ordered-preflight", preflight ? "present" : "missing");
                record(revision, "candidate", "ordered-preflight", "blocked-eager-umd");
                return false;
            }
            // A stalled positive control must leave the independent UMD observation available.
            if (!controlStarted) {
                controlStarted = true;
                void runControl(revision);
            }
            if (!current(revision, isCurrent)) return false;
            // Native import cannot be canceled after dispatch. Record its outcome even if the
            // decision expires in flight. Registration and enablement still need a live decision.
            candidate ??= importCandidate(revision);
            const value = await candidate;
            if (!current(revision, isCurrent) || !value || registrationFailed) return false;
            if (!registered) {
                try {
                    register(value);
                    registered = true;
                    record(revision, "candidate", "register", "registered");
                } catch (error) {
                    registrationFailed = true;
                    record(revision, "candidate", "register", "threw", candidateErrorClass(error));
                    return false;
                }
            }
            return true;
        },
        afterDisable() { ordinary("after-disable"); },
    };
}
