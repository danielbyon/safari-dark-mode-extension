import type DarkReader from "darkreader";
import { candidateErrorClass } from "./candidate-loader.ts";
import type { Appearance } from "./eligibility.ts";

export type Candidate = Pick<typeof DarkReader, "enable" | "disable" | "isEnabled" | "setFetchMethod">;
export type Trace = (event: string, fields?: Record<string, string | number | boolean | null>) => void;
export type ReadStylesheet = (url: string, revision: number, signal: AbortSignal) => Promise<string>;
export type RenderInput = {
    revision: number;
    enabled: boolean;
    fix: boolean;
    privileged: boolean;
    renderer: "marker" | "candidate";
    appearance: Appearance;
};

export const FIX_VERSION = 1;
const fixCSS = "#fixture-essential-control:focus { outline: 2px solid currentColor !important; outline-offset: 2px !important; }";

/**
 * A Dark Reader fetch callback receives only a URL. Once its first rendering
 * decision expires, even a brand-new callback could be called by old work.
 * Only a new content world can establish another attributable decision.
 */
export class CandidateReads {
    private revision?: number;
    private controller = new AbortController();
    private read: ReadStylesheet;
    private current: (revision: number) => boolean;
    private trace: Trace;

    constructor(read: ReadStylesheet, current: (revision: number) => boolean, trace: Trace) {
        this.read = read;
        this.current = current;
        this.trace = trace;
    }

    bind(revision: number) {
        if (this.revision !== undefined && revision !== this.revision) this.invalidate();
        this.revision ??= revision;
    }

    invalidate() {
        if (this.revision !== undefined) this.controller.abort();
    }

    fetch = async (url: string): Promise<Response> => {
        const revision = this.revision;
        const signal = this.controller.signal;
        this.trace("candidate-hook-entry", { revision: revision ?? null });
        if (revision === undefined || signal.aborted || !this.current(revision)) {
            this.trace("candidate-hook-refused");
            throw new Error("Unattributable stylesheet read");
        }
        const css = await this.read(url, revision, signal);
        const check = () => {
            if (signal.aborted || !this.current(revision)) {
                this.trace("stale-response-rejected", { revision });
                throw new Error("Expired stylesheet read");
            }
        };
        check();
        const bytes = new TextEncoder().encode(css).length;
        const consumed = () => {
            check();
            this.trace("candidate-body-delivered", { revision, bytes });
        };
        // The audited UMD consumes text() for CSS and blob() for data URLs.
        // Receiving the Response itself can precede either body read.
        const response = new class extends Response {
            override async text() {
                const body = await super.text();
                consumed();
                return body;
            }
            override async blob() {
                const body = await super.blob();
                consumed();
                return body;
            }
        }(css, { headers: { "Content-Type": "text/css" } });
        this.trace("candidate-response-released", { revision, bytes });
        return response;
    };
}

/** Only the returned style node belongs to the marker. Website nodes survive teardown. */
function appendStyle(doc: Document, css: string) {
    const style = doc.createElement("style");
    style.textContent = css;
    (doc.head ?? doc.documentElement).append(style);
    return style;
}

type RootColors = { color: string | null; background: string | null };

/** Copy both values immediately. A retained CSSStyleDeclaration follows later style changes. */
function rootColors(doc: Document): RootColors {
    try {
        const css = doc.documentElement && doc.defaultView?.getComputedStyle(doc.documentElement);
        return { color: css?.color || null, background: css?.backgroundColor || null };
    } catch {
        return { color: null, background: null };
    }
}

function markerResult(before: RootColors, expected: RootColors, after: RootColors) {
    if (!before.color || !before.background || !after.color || !after.background) return "unavailable";
    const changed = before.color !== after.color || before.background !== after.background;
    if (after.color === expected.color && after.background === expected.background) {
        return changed ? "applied" : "already-matched";
    }
    return changed ? "mismatch" : "unchanged";
}

export class FrameRenderer {
    private doc: Document;
    private reads: CandidateReads;
    private trace: Trace;
    private marker?: HTMLStyleElement;
    private candidate?: Candidate;
    private candidateStarted = false;
    private afterDisable: () => void;

    constructor(doc: Document, reads: CandidateReads, trace: Trace, afterDisable: () => void) {
        this.doc = doc;
        this.reads = reads;
        this.trace = trace;
        this.afterDisable = afterDisable;
    }

    register(candidate: Candidate) {
        candidate.setFetchMethod(this.reads.fetch);
        this.candidate = candidate;
    }

    disable() {
        this.reads.invalidate();
        this.marker?.remove();
        this.marker = undefined;
        if (this.candidateStarted && this.candidate) {
            try {
                this.candidate.disable();
                this.trace("candidate-disabled", { enabled: this.candidate.isEnabled() });
            } catch (error) {
                this.trace("candidate-disable-failed", { errorClass: candidateErrorClass(error) });
                throw error;
            } finally {
                this.candidateStarted = false;
                this.afterDisable();
            }
        }
    }

    apply(input: RenderInput) {
        this.disable();
        if (!input.enabled) return;
        const { brightness, linkColor, mode } = input.appearance;
        if (!Number.isFinite(brightness) || brightness < 0 || brightness > 200 || !/^#[a-f\d]{6}$/i.test(linkColor)) {
            throw new Error("Invalid fixture appearance");
        }
        // Scope the synthetic link override to links on these controlled fixture pages.
        const linkCSS = `a:any-link { color: ${linkColor} !important; }`;
        const repair = input.fix ? fixCSS : "";
        if (input.renderer === "candidate") {
            if (!this.candidate) throw new Error("Candidate UMD unavailable");
            this.reads.bind(input.revision);
            this.candidateStarted = true;
            try {
                this.trace("candidate-enable-attempt", { revision: input.revision });
                this.candidate.enable({
                    brightness,
                    ...(mode === "palette" && { darkSchemeBackgroundColor: "#112535", darkSchemeTextColor: "#e0f4ff" }),
                }, { css: `${linkCSS}\n${repair}` });
                this.trace("candidate-enabled", { enabled: this.candidate.isEnabled(), revision: input.revision, fixVersion: input.fix ? FIX_VERSION : null });
            } catch (error) {
                this.trace("candidate-enable-failed", { revision: input.revision, errorClass: candidateErrorClass(error) });
                this.disable();
                throw error;
            }
        } else {
            const expected = {
                color: "rgb(224, 244, 255)",
                background: mode === "palette" ? "rgb(17, 37, 53)" : "rgb(24, 26, 27)",
            };
            const before = rootColors(this.doc);
            this.marker = appendStyle(this.doc, `:root { --probe-brightness: ${brightness}; background-color: ${expected.background} !important; color: ${expected.color} !important; }\n${linkCSS}\n${repair}`);
            this.trace("marker-inserted", { revision: input.revision, fixVersion: input.fix ? FIX_VERSION : null });
            const after = rootColors(this.doc);
            this.trace("marker-root-style", {
                revision: input.revision, result: markerResult(before, expected, after),
                beforeColor: before.color, beforeBackground: before.background,
                expectedColor: expected.color, expectedBackground: expected.background,
                afterColor: after.color, afterBackground: after.background,
            });
        }
    }
}

/** Sample the distinctive resource rule as well as Dark Reader's generated DOM and CSSOM. */
export function effectSample(doc: Document): Record<string, number | string | null> {
    const styles = doc.querySelectorAll<HTMLStyleElement>("style.darkreader");
    let rules = 0;
    let hash = 0;
    let opaque = 0;
    for (const style of styles) {
        try {
            for (const rule of style.sheet?.cssRules ?? []) {
                rules++;
                const text = rule.cssText;
                for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
            }
        } catch {
            opaque++;
        }
    }
    const swatch = doc.querySelector("#resource-swatch");
    const control = doc.querySelector("#fixture-essential-control");
    const computed = swatch && doc.defaultView?.getComputedStyle(swatch);
    const outline = control && doc.defaultView?.getComputedStyle(control);
    return {
        sheets: styles.length, rules, hash, opaque,
        swatchColor: computed?.color ?? null,
        swatchBackground: computed?.backgroundColor ?? null,
        swatchBorder: computed?.borderLeftColor ?? null,
        controlOutline: outline?.outlineWidth ?? null,
        mode: doc.documentElement?.getAttribute("data-darkreader-mode") === "dynamic" ? "dynamic" : null,
    };
}
