/** Safari answers permission queries for match patterns. Transport stays on an exact fixture origin. */
export type FixtureRole = "top" | "frame" | "resource" | "denied";
export const fixtureRoles = ["top", "frame", "resource", "denied"] as const;
export type GrantSnapshot = Record<FixtureRole, boolean | null>;
export type Setting = "allow" | "deny" | "ask";

export function permissionPattern(origin: string): string {
    const url = new URL(origin);
    return `${url.protocol}//${url.hostname}/*`;
}

type CalibrationSample = {
    role: FixtureRole;
    expected: Setting;
    grants: GrantSnapshot;
};

/** Keep calibration in memory for one background instance and browsing context. */
export class GrantCalibration {
    private samples: CalibrationSample[] = [];

    record(role: FixtureRole, expected: Setting, grants: GrantSnapshot) {
        const observed = grants[role];
        if (observed !== (expected === "allow")) {
            this.samples = this.samples.filter(sample => sample.role !== role);
        } else {
            // A repeated sample replaces its previous result for the same combination of grants.
            this.samples = this.samples.filter(sample => !(sample.role === role &&
                sample.expected === expected && fixtureRoles.every(key => sample.grants[key] === grants[key])));
            this.samples.push({role, expected, grants: {...grants}});
        }
        return {role, expected, observed, qualified: this.qualified(role), grants};
    }

    /** The document grants must have stayed positive on both sides of a separate resource grant. */
    qualified(role: FixtureRole, documentRoles: readonly FixtureRole[] = []): boolean {
        const matches = this.samples.filter(sample => sample.role === role &&
            documentRoles.every(peer => peer === role || sample.grants[peer] === true));
        return matches.some(sample => sample.expected === "allow") &&
            matches.some(sample => sample.expected === "deny");
    }
}

export type ReadReply = {ok: true; css: string} | {ok: false; reason: string};
type ReadOptions = {
    destinations: ReadonlySet<string>;
    current: (revision: number) => boolean;
    authorized: (destination: URL, revision: number) => Promise<boolean>;
    trace: (event: string) => void;
    fetch: typeof fetch;
};

/** One reader belongs to one runtime port. After invalidation a new document must open a new port. */
export class DocumentReader {
    private revision: number | undefined;
    private retired = false;
    private lastId = -1;
    private pending = new Set<AbortController>();
    private options: ReadOptions;

    constructor(options: ReadOptions) {
        this.options = options;
    }

    bind(revision: number): boolean {
        if (this.retired) return false;
        if (this.revision !== undefined && this.revision !== revision) this.invalidate();
        if (this.retired) return false;
        this.revision = revision;
        return true;
    }

    invalidate() {
        this.retired = true;
        for (const controller of this.pending) {
            this.options.trace("abort-requested");
            controller.abort();
        }
    }

    private current(revision: number) {
        return !this.retired && revision === this.revision && this.options.current(revision);
    }

    async read(id: number, revision: number, rawURL: string): Promise<ReadReply> {
        const refuse = (reason: string): ReadReply => {
            this.options.trace(reason);
            return {ok: false, reason};
        };
        if (!Number.isSafeInteger(id) || id <= this.lastId) return refuse("invalid-or-replayed-id");
        this.lastId = id;
        if (!this.current(revision)) return refuse("stale-decision");
        // Compare the original serialization too. Credentials, fragments and extra query keys have no fixture route.
        if (!this.options.destinations.has(rawURL)) return refuse("outside-fixture-routes");
        const url = new URL(rawURL);
        const controller = new AbortController();
        this.pending.add(controller);
        try {
            if (!await this.options.authorized(url, revision)) return refuse("grant-or-identity-unavailable");
            if (!this.current(revision)) return refuse("stale-decision");
            this.options.trace("privileged-get-dispatched");
            const response = await this.options.fetch(url, {
                method: "GET", redirect: "error", credentials: "omit", referrerPolicy: "no-referrer",
                cache: "no-store", signal: controller.signal,
            });
            if (!this.current(revision)) return refuse("stale-response-rejected");
            if (!response.ok || response.redirected || response.url !== rawURL ||
                response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "text/css") {
                return refuse("unusable-stylesheet-response");
            }
            const css = await response.text();
            if (!this.current(revision) || !await this.options.authorized(url, revision) || !this.current(revision)) {
                return refuse("stale-response-rejected");
            }
            this.options.trace("stylesheet-ready");
            return {ok: true, css};
        } catch (error) {
            // A client-side AbortError does not establish how many bytes the server sent.
            const aborted = controller.signal.aborted && error instanceof Error && error.name === "AbortError";
            return refuse(aborted ? "read-aborted" : "read-failed");
        } finally {
            this.pending.delete(controller);
        }
    }
}
