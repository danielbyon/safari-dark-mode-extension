import {
    DEFAULT_PREFERENCES, resolvePreferences, decideEligibility,
    type Access, type AppearanceDraft, type SavedPreferences, type Scope, type Appearance,
} from "./eligibility.ts";
import { candidateLoadTrace } from "./candidate-loader.ts";
import { fixtureOrigins, resourcePaths } from "./fixture-config.ts";
import { TabLifecycle, type OverrideRecord } from "./lifecycle.ts";
import {
    DocumentReader, GrantCalibration, fixtureRoles, permissionPattern,
    type FixtureRole, type GrantSnapshot, type Setting,
} from "./resource-loader.ts";
import { DEFAULT_SCHEDULE, isScheduleActive, isValidSchedule, type Schedule } from "./schedule.ts";

type Port = browser.runtime.Port;
type Fields = Record<string, unknown>;
type Detection = "light" | "dark" | "unknown";
type Renderer = "marker" | "candidate";
type Decision = {
    type: "decision"; instance: string; revision: number; enabled: boolean; fix: boolean;
    reason: string; appearance: Appearance; renderer: Renderer; privileged: boolean; inputRevision: number;
};
type LiveTab = { life: TabLifecycle; url: URL; documentId: string; private: boolean };
type Doc = {
    port: Port; tabId: number; frameId: number; url: URL; documentId?: string; private: boolean;
    bindingId: string; tabAlias: number; alias: number; awaitingCommit: boolean; fresh: boolean; registration?: string; ancestors?: number[]; nativeDark?: Detection; systemDark: boolean; reader: DocumentReader;
    fingerprint?: string; decision?: Decision; eligibleRoles: Set<FixtureRole>; inputRevision: number;
};
type Editor = {port: Port; tabId: number; private: boolean; token?: symbol; connected: boolean; displaced: boolean};
type Settings = {paused: boolean; renderer: Renderer; access: Access; schedule: Schedule; saved: SavedPreferences};

const uid = () => Array.from(crypto.getRandomValues(new Uint32Array(3)), word => word.toString(16)).join("-");

const fixturePages = new Set(["/", "/page.html", "/next/page.html", "/private/page.html", "/frame.html"]);

const key = (tab: number, frame: number) => `${tab}/${frame}`;

const sessionKey = (id: number) => `probe-override-${id}`;

const destinations = new Set(fixtureRoles.flatMap(role => resourcePaths.map(path => fixtureOrigins[role] + path)));

const settingsKey = "safari-capability-settings-v1";

const stateForContext = () => ({
    proof: new GrantCalibration(), calibration: [] as ReturnType<GrantCalibration["record"]>[],
    observations: [] as Fields[], sequence: 0,
});

function object(value: unknown): value is Fields {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function post(port: Port, message: object) {
    try { port.postMessage(message); } catch { /* A disconnected popup cannot receive the last refresh. */ }
}

function roleOf(address: URL): FixtureRole | undefined {
    if (address.username || address.password) return undefined;
    return fixtureRoles.find(role => fixtureOrigins[role] === address.origin);
}

function address(value: unknown): URL | undefined {
    if (typeof value !== "string") return undefined;
    try {
        const url = new URL(value);
        return roleOf(url) && fixturePages.has(url.pathname) ? url : undefined;
    } catch { return undefined; }
}

function documentId(value: object): string | undefined {
    return "documentId" in value && typeof value.documentId === "string" ? value.documentId : undefined;
}

const traceEvents = new Set([
    "injected", "ordinary-message", "ordinary-reply", "ordinary-reply-rejected", "native-dark-read",
    "candidate-hook-entry", "candidate-hook-refused", "stale-response-rejected", "candidate-response-released", "candidate-body-delivered",
    "candidate-enabled", "candidate-disabled", "marker-inserted", "marker-root-style", "content-read-invalidated", "render-effects",
    "candidate-dom-mutation", "teardown-error", "render-error", "candidate-load-stage",
    "candidate-enable-attempt", "candidate-enable-failed", "candidate-disable-failed",
    "document-disconnected", "document-port-unavailable", "content-decision",
]);
const traceNumbers = new Set("ms at revision bytes id generation receiverCount sheets rules hash opaque fixVersion".split(" "));
const traceFlags = new Set("top enabled eligible echoed privileged".split(" "));
const rootColorFields = new Set(["beforeColor", "beforeBackground", "expectedColor", "expectedBackground", "afterColor", "afterBackground"]);
const markerResults = new Set(["applied", "unchanged", "already-matched", "mismatch", "unavailable"]);
const traceEnums = new Set(("before-import after-import after-disable unavailable promise undefined object function threw " +
    "mutation before-decision after-teardown after-apply snapshot poll connect document-ready visible history hash " +
    "system light dark unknown unreadable no-declaration root-declaration ambiguous loading interactive complete dynamic").split(" "));

function scopeFor(name: unknown, url: URL): Scope {
    switch (name) {
        case "global": return {kind: "default"};
        case "domain": return {kind: "domain", domain: url.hostname};
        case "host": return {kind: "host", hostname: url.hostname};
        case "page": return {kind: "page", hostname: url.hostname, path: url.pathname};
        case "section": return {kind: "section", hostname: url.hostname, path: url.pathname.slice(0, url.pathname.lastIndexOf("/")) || "/"};
        default: throw Error("unknown-scope");
    }
}

type Edits = { -readonly [K in keyof SavedPreferences["defaults"]]?: SavedPreferences["defaults"][K] | null };
function parseEdits(value: unknown, scope: Scope, preview: boolean): Edits {
    if (!object(value)) throw Error("invalid-fields");
    const edits: Edits = {};
    for (const [key, v] of Object.entries(value)) {
        if (key === "theme" && (v === null || v === "graphite" || v === "ocean")) edits.theme = v;
        else if (key === "appearance" && (v === null || v === "adaptive" || v === "custom")) {
            edits.theme = v === null ? null : v === "adaptive" ? "graphite" : "ocean";
        } else if (key === "brightness" && (v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 200))) edits.brightness = v;
        else if (key === "linkColor" && (v === null || (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)))) edits.linkColor = v;
        else if (!preview && key === "useMyTheme" && (v === null || typeof v === "boolean")) edits.useMyTheme = v;
        else if (!preview && key === "activation" && (v === null || v === "on" || v === "off" || v === "system" ||
            v === "follow-system" || (scope.kind === "default" && v === "schedule"))) edits.activation = v === "system" ? "follow-system" : v;
        else throw Error("invalid-field");
    }
    return edits;
}

function editSaved(saved: SavedPreferences, scope: Scope, edits: Edits): SavedPreferences {
    const same = (rule: SavedPreferences["rules"][number]) => JSON.stringify(rule.scope) === JSON.stringify(scope);
    const current = scope.kind === "default" ? saved.defaults : saved.rules.find(same)?.values;
    const values = Object.fromEntries(Object.entries({...current, ...edits}).filter(([,v]) => v !== null));
    const revision = saved.revision + 1;
    if (scope.kind === "default") return {...saved, revision, defaults: values};
    const rules = saved.rules.filter(rule => !same(rule));
    if (Object.keys(values).length) rules.push({scope, values});
    return {...saved, revision, rules};
}

/** Only explicitly saved fixture scopes enter durable storage. Recheck them on background wake. */
function readSaved(value: unknown): SavedPreferences {
    if (!object(value) || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0 || !Array.isArray(value.rules)) {
        throw Error("invalid-preferences");
    }
    const defaults = Object.fromEntries(Object.entries(parseEdits(value.defaults, {kind: "default"}, false))
        .filter(([,v]) => v !== null));
    const rules: SavedPreferences["rules"][number][] = [];
    for (const rule of value.rules) {
        if (!object(rule) || !object(rule.scope)) throw Error("invalid-rule");
        const scope = rule.scope;
        const host = scope.kind === "domain" ? scope.domain : scope.hostname;
        const origin = Object.values(fixtureOrigins).find(origin => new URL(origin).hostname === host);
        if (!origin) throw Error("invalid-rule-host");
        const page = new URL(origin);
        if (scope.kind === "page" || scope.kind === "section") {
            if (typeof scope.path !== "string" || !scope.path.startsWith("/")) throw Error("invalid-rule-path");
            page.pathname = scope.path;
            if (page.pathname !== scope.path) throw Error("invalid-rule-path");
        }
        const normalized = scope.kind === "section" ? {kind: "section" as const, hostname: page.hostname, path: page.pathname}
            : scopeFor(scope.kind, page);
        if (normalized.kind === "default") throw Error("invalid-rule-scope");
        const fields = Object.fromEntries(Object.entries(parseEdits(rule.values, normalized, false)).filter(([,v]) => v !== null));
        rules.push({scope: normalized, values: fields});
    }
    return {revision: Number(value.revision), defaults, rules};
}

function parseAccess(value: unknown): Access {
    if (value === "refreshing-unknown") return "refreshing";
    if (value === "valid" || value === "inactive" || value === "unknown" || value === "refreshing-valid" || value === "refreshing") return value;
    throw Error("invalid-access");
}

/** One instance owns the live ports, grant samples and pending reads for this background lifetime. */
export function registerBackground(api: typeof browser) {
    const instance = uid();
    const canObserveRevocation = typeof api.permissions?.onRemoved?.addListener === "function";
    const tabs = new Map<number, LiveTab>();
    const documents = new Map<string, Doc>();
    const activeTabs = new Map<number, number>();
    const tabAliases = new Map<number, number>();
    let nextTabAlias = 0;
    let nextDocumentAlias = 0;
    const editors = new Set<Editor>();
    const echoCounts = new Map<string, Map<number, number>>();
    // A committed navigation can admit at most one content port, including on builds without documentId.
    const navigating = new Map<string, string>();
    const arrivals = new Map<string, {url: string; documentId?: string}>();
    const settings: Settings = {
        paused: false, renderer: "marker", access: "valid", saved: DEFAULT_PREFERENCES, schedule: DEFAULT_SCHEDULE,
    };
    const regular = stateForContext();
    const isolated = stateForContext();
    const context = (incognito: boolean) => incognito ? isolated : regular;
    let revision = 0;
    // A permission event retires grant samples even while Safari is resolving the frame tree.
    let permissionEpoch = 0;
    let queued = 0;
    let tail: Promise<void> = Promise.resolve();

    function record(incognito: boolean, event: string, fields: Fields = {}) {
        const c = context(incognito);
        c.observations.push({sequence: ++c.sequence, event, ...fields});
        if (c.observations.length > 128) c.observations.shift();
    }

    function observe(doc: Doc, event: string, fields: Fields = {}) {
        record(doc.private, event, {tab: doc.tabAlias, document: doc.alias, role: roleOf(doc.url),
            frame: doc.frameId === 0 ? "top" : "child", ...fields});
    }

    function enqueue(task: () => Promise<void>, failure?: () => void) {
        queued++;
        tail = tail.then(task).catch(() => failure?.()).finally(() => { queued--; });
    }

    async function grant(role: FixtureRole): Promise<boolean | null> {
        try {
            const value = await api.permissions.contains({origins: [permissionPattern(fixtureOrigins[role])]});
            return typeof value === "boolean" ? value : null;
        } catch { return null; }
    }

    async function sampleGrants(): Promise<GrantSnapshot> {
        const [top, frame, resource, denied] = await Promise.all(fixtureRoles.map(grant));
        return {top, frame, resource, denied};
    }

    function privateAllowed(incognito: boolean): Promise<boolean> {
        if (!incognito) return Promise.resolve(true);
        return Promise.resolve().then(() => api.extension.isAllowedIncognitoAccess()).catch(() => false);
    }

    function live(doc: Doc) {
        return documents.get(key(doc.tabId, doc.frameId)) === doc;
    }

    /** Match each live port to Safari's current frame tree, including the ancestors of a nested frame. */
    async function authorizedFrames(doc: Doc, grants: GrantSnapshot): Promise<FixtureRole[] | undefined> {
        try {
            const [tab, frames, allowed] = await Promise.all([
                api.tabs.get(doc.tabId), api.webNavigation.getAllFrames({tabId: doc.tabId}), privateAllowed(doc.private),
            ]);
            if (!allowed || !live(doc) || doc.awaitingCommit || tab.incognito !== doc.private) return;
            const byId = new Map(frames.map(frame => [frame.frameId, frame]));
            const visited = new Set<number>();
            const roles: FixtureRole[] = [];
            let frameId = doc.frameId;
            while (!visited.has(frameId)) {
                visited.add(frameId);
                const frame = byId.get(frameId);
                const owner = documents.get(key(doc.tabId, frameId));
                if (!frame || !owner || owner.awaitingCommit || (frame.tabId !== undefined && frame.tabId !== doc.tabId) || owner.private !== doc.private || frame.errorOccurred ||
                    frame.url !== owner.url.href || (frameId === 0 && frame.url !== tab.url)) return;
                const frameDocumentId = documentId(frame);
                if (owner.documentId && frameDocumentId && owner.documentId !== frameDocumentId) return;
                const role = roleOf(owner.url);
                if (!role || grants[role] !== true || !context(doc.private).proof.qualified(role)) return;
                roles.push(role);
                if (frameId === 0) { doc.ancestors = [...visited]; return roles; }
                frameId = frame.parentFrameId;
            }
        } catch { /* Unavailable frame or private-context information leaves the sender unqualified. */ }
    }

    function inputs(doc: Doc, authorized: boolean) {
        const tab = tabs.get(doc.tabId);
        const top = documents.get(key(doc.tabId, 0));
        const url = tab?.url ?? doc.url;
        const prefs = resolvePreferences(settings.saved, {url, domain: url.hostname}, tab?.life.preview);
        const data = {
            preferences: prefs, topAuthorized: authorized && !!tab && !!top?.nativeDark && top.bindingId === tab.documentId && top.url.href === tab.url.href,
            frameAuthorized: authorized && !!doc.nativeDark, access: settings.access, paused: settings.paused,
            preview: !!tab?.life.preview, tabOverride: tab?.life.tabOverride ?? null,
            systemDark: top?.systemDark ?? false, scheduleActive: isScheduleActive(settings.schedule),
            topNativeDark: top?.nativeDark === "dark", frameNativeDark: doc.nativeDark === "dark",
        };
        return {data, decision: decideEligibility(data)};
    }

    async function authorizeRead(doc: Doc, url: URL, expectedRevision: number) {
        const role = roleOf(url);
        if (!role || !doc.eligibleRoles.has(role)) return false;
        const epoch = permissionEpoch;
        const grants = await sampleGrants();
        const roles = await authorizedFrames(doc, grants);
        if (epoch !== permissionEpoch) return false;
        const permit = !!roles && grants[role] === true && context(doc.private).proof.qualified(role, roles);
        observe(doc, "read-grant-check", {destination: role, grants, permit});
        return permit && queued === 0 && doc.decision?.revision === expectedRevision && inputs(doc, true).decision.render;
    }

    async function updateDocument(doc: Doc, grants: GrantSnapshot, epoch: number) {
        const roles = await authorizedFrames(doc, grants);
        if (epoch !== permissionEpoch || !live(doc)) return;
        const {data, decision} = inputs(doc, !!roles);
        const draft = tabs.get(doc.tabId)?.life.preview;
        const fingerprint = JSON.stringify([data, draft, settings.renderer, doc.url.href, roles ?? null, doc.inputRevision]);
        if (fingerprint === doc.fingerprint) return;
        if (doc.decision?.enabled) doc.reader.invalidate();
        const next = ++revision;
        const privileged = decision.render && settings.renderer === "candidate" && canObserveRevocation && doc.fresh && !!(doc.documentId || doc.registration) && !!roles &&
            roles.every(role => doc.eligibleRoles.has(role)) && doc.reader.bind(next);
        doc.fingerprint = fingerprint;
        doc.decision = {
            type: "decision", instance, revision: next, reason: decision.reason, renderer: settings.renderer,
            enabled: decision.render, fix: decision.render, privileged, appearance: data.preferences.appearance,
            inputRevision: doc.inputRevision,
        };
        post(doc.port, doc.decision);
        observe(doc, "decision", {revision: next, reason: decision.reason, privileged});
    }

    async function refresh(tabId?: number) {
        const epoch = permissionEpoch;
        const grants = await sampleGrants();
        if (epoch !== permissionEpoch) return;
        const targets = [...documents.values()].filter(doc => tabId === undefined || doc.tabId === tabId);
        await Promise.all(targets.map(doc => updateDocument(doc, grants, epoch)));
        if (epoch !== permissionEpoch) return;
        for (const e of editors) if (e.connected && (tabId === undefined || e.tabId === tabId)) publish(e, grants);
    }

    function publish(e: Editor, grants: GrantSnapshot) {
        const tab = tabs.get(e.tabId);
        const c = context(e.private);
        post(e.port, {
            type: "state", instance, paused: settings.paused, renderer: settings.renderer,
            access: settings.access === "refreshing" ? "refreshing-unknown" : settings.access,
            schedule: {days: settings.schedule.weekdays, start: settings.schedule.start, end: settings.schedule.end},
            savedRevision: settings.saved.revision, preview: tab?.life.ownsEditor(e.token) ? tab.life.preview : null,
            override: tab?.life.tabOverride ?? null, private: e.private, grants,
            calibration: c.calibration, observations: c.observations, decision: documents.get(key(e.tabId, 0))?.decision ?? null,
        });
    }

    async function forgetOverride(id: number) {
        try { await api.storage.session.remove(sessionKey(id)); }
        catch { /* Older Safari builds keep the override in this instance only. */ }
    }

    async function saveOverride(tab: LiveTab) {
        const recordValue = tab.life.overrideRecord;
        const top = documents.get(key(tab.life.tabId, 0));
        if (!recordValue) return forgetOverride(tab.life.tabId);
        try { await api.storage.session.set({[sessionKey(tab.life.tabId)]: {...recordValue, private: tab.private, browserDocument: top?.documentId ?? null, registration: top?.registration ?? null}}); }
        catch { record(tab.private, "session-storage-unavailable"); }
    }

    async function bindTab(id: number, url: URL, incognito: boolean, identity: string) {
        const owner = documents.get(key(id, 0));
        const prior = tabs.get(id);
        if (prior && prior.private === incognito) {
            if (prior.documentId !== identity || prior.url.href !== url.href) {
                const oldHost = prior.url.hostname;
                prior.life.navigate({documentId: identity, url: url.href});
                prior.documentId = identity;
                prior.url = url;
                if (oldHost !== url.hostname) await forgetOverride(id);
            }
            if (prior.life.tabOverride) await saveOverride(prior);
            return prior;
        }
        let stored: (OverrideRecord & {private: boolean}) | undefined;
        try {
            const item = (await api.storage.session.get(sessionKey(id)))[sessionKey(id)];
            if (object(item) && item.private === incognito && item.tabId === id && item.hostname === url.hostname &&
                typeof item.lifetimeId === "string" &&
                (owner?.documentId && typeof item.browserDocument === "string"
                    ? item.browserDocument === owner.documentId
                    : !!owner?.registration && item.registration === owner.registration) && (item.value === "on" || item.value === "off")) {
                stored = {tabId: id, hostname: url.hostname, lifetimeId: item.lifetimeId, value: item.value, private: incognito};
            } else if (item) {
                record(incognito, "session-continuity-unproven");
                await forgetOverride(id);
            }
        } catch { record(incognito, "session-storage-unavailable"); }
        // A surviving document corroborates the session record. Tab replacement and removal retire it.
        const life = new TabLifecycle(id, {documentId: identity, url: url.href}, stored?.lifetimeId ?? uid());
        if (stored) life.restoreOverride(stored);
        const tab = {life, documentId: identity, url, private: incognito};
        tabs.set(id, tab);
        return tab;
    }

    function drop(doc: Doc) {
        if (!live(doc)) return;
        documents.delete(key(doc.tabId, doc.frameId));
        doc.reader.invalidate();
        doc.port.disconnect();
    }

    function dropFrames(id: number, frameId: number) {
        // Safari may recycle descendant frame numbers. Closing their ports prevents a new parent inheriting old work.
        for (const doc of documents.values()) {
            if (doc.tabId === id && (frameId === 0 || doc.frameId === frameId || doc.ancestors?.includes(frameId) === true)) drop(doc);
        }
    }

    function contentConnected(port: Port) {
        const sender = port.sender;
        const tabId = sender?.tab?.id;
        const frameId = sender?.frameId;
        const url = address(sender?.url);
        if (sender?.id !== api.runtime.id || tabId === undefined || frameId === undefined || frameId < 0 ||
            !url || roleOf(url) === "resource" || typeof sender.tab?.incognito !== "boolean" ||
            ("origin" in sender && sender.origin !== url.origin)) return port.disconnect();
        const incognito = sender.tab.incognito;
        const k = key(tabId, frameId);
        const previous = documents.get(k);
        const arrival = arrivals.get(k);
        arrivals.delete(k);
        const browserId = documentId(sender);
        const fresh = !previous && arrival?.url === url.href && (!arrival.documentId || !browserId || arrival.documentId === browserId);
        if (previous) dropFrames(tabId, frameId);
        const reader = new DocumentReader({
            destinations, current: rev => live(doc) && queued === 0 && doc.decision?.revision === rev && doc.decision.privileged,
            authorized: (dest, rev) => authorizeRead(doc, dest, rev),
            fetch: (dest, options) => fetch(dest, options), trace: event => observe(doc, event),
        });
        const tabAlias = tabAliases.get(tabId) ?? ++nextTabAlias;
        tabAliases.set(tabId, tabAlias);
        const doc: Doc = {
            bindingId: browserId ?? uid(), tabAlias, alias: ++nextDocumentAlias, awaitingCommit: navigating.get(k) === url.href,
            port, tabId, frameId, url, documentId: browserId, private: incognito, fresh, reader, systemDark: false, inputRevision: 0,
            eligibleRoles: new Set(fixtureRoles.filter(role => context(incognito).proof.qualified(role))),
        };
        documents.set(k, doc);
        if (sender.tab.active && sender.tab.windowId !== undefined) activeTabs.set(sender.tab.windowId, tabId);
        enqueue(async () => {
            if (!live(doc)) return;
            if (frameId === 0 && browserId) await bindTab(tabId, url, incognito, doc.bindingId);
            if (arrival) observe(doc, "matched-committed-navigation", {fresh});
            observe(doc, "document-connected", {fresh, browserDocumentId: !!browserId});
            await refresh(tabId);
        });
        port.onDisconnect.addListener(() => {
            if (!live(doc)) return;
            documents.delete(k);
            reader.invalidate();
            if (frameId === 0) expireEditors(tabId);
            dropFrames(tabId, frameId);
            enqueue(() => refresh(tabId));
        });
        port.onMessage.addListener(message => {
            if (!object(message) || !live(doc)) return;
            if (message.type === "hello" && !doc.registration && typeof message.registration === "string" &&
                /^[0-9a-f]{16,128}$/.test(message.registration)) {
                doc.registration = message.registration;
                enqueue(async () => {
                    if (!live(doc) || frameId !== 0) return;
                    await bindTab(tabId, url, incognito, doc.bindingId);
                    await refresh(tabId);
                });
            } else if (message.type === "read") {
                const {id, revision: rev, url: destination} = message;
                if (typeof id !== "number" || typeof rev !== "number" || typeof destination !== "string") return;
                void reader.read(id, rev, destination).then(reply => {
                    const freshReply = reply.ok && (!live(doc) || queued !== 0 || doc.decision?.revision !== rev || !doc.decision.privileged)
                        ? {ok: false, reason: "stale-response-rejected"} : reply;
                    post(port, {type: "read-result", id, revision: rev, ...freshReply});
                });
            } else if (message.type === "report" && typeof message.systemDark === "boolean" &&
                (message.nativeDark === "light" || message.nativeDark === "dark" || message.nativeDark === "unknown")) {
                if (typeof message.inputRevision !== "number" || !Number.isSafeInteger(message.inputRevision) ||
                    message.inputRevision <= doc.inputRevision) return;
                doc.inputRevision = message.inputRevision;
                doc.nativeDark = message.nativeDark;
                doc.systemDark = message.systemDark;
                enqueue(() => refresh(tabId));
            } else if (message.type === "trace") {
                traceContent(doc, message);
            }
        });
    }

    function traceContent(doc: Doc, message: Fields) {
        if (typeof message.event !== "string" || !traceEvents.has(message.event)) return;
        const fields: Fields = {};
        if (typeof message.ms === "number" && Number.isFinite(message.ms)) fields.ms = message.ms;
        if (object(message.fields)) for (const [name, value] of Object.entries(message.fields)) {
            if (message.event === "candidate-load-stage") {
                const allowed: readonly string[] | undefined = Object.hasOwn(candidateLoadTrace, name)
                    ? candidateLoadTrace[name as keyof typeof candidateLoadTrace] : undefined;
                if (allowed && typeof value === "string" && allowed.includes(value)) fields[name] = value;
            }
            if ((message.event === "candidate-enable-failed" || message.event === "candidate-disable-failed") &&
                name === "errorClass" && candidateLoadTrace.errorClass.some(label => value === label)) fields[name] = value;
            if (traceNumbers.has(name) && (value === null || (typeof value === "number" && Number.isFinite(value)))) fields[name] = value;
            if (traceFlags.has(name) && typeof value === "boolean") fields[name] = value;
            if (message.event === "marker-root-style") {
                if (name === "result" && typeof value === "string" && markerResults.has(value)) fields[name] = value;
                if (rootColorFields.has(name) && (value === null || (typeof value === "string" && /^rgba?\([0-9., %/]+\)$/.test(value)))) fields[name] = value;
            }
            if (["phase","returned","trigger","source","scheme","reason","readyState","mode"].includes(name) &&
                typeof value === "string" && traceEnums.has(value)) fields[name] = value;
            if (["swatchColor","swatchBackground","swatchBorder","controlOutline"].includes(name) &&
                typeof value === "string" && /^(?:rgba?\([0-9., %/]+\)|[0-9.]+px)$/.test(value)) fields[name] = value;
        }
        observe(doc, message.event, fields);
    }

    async function persist(change: Partial<Settings>) {
        const next = {...settings, ...change};
        await api.storage.local.set({[settingsKey]: next});
        Object.assign(settings, next);
    }

    function requireLiveEditor(e: Editor) {
        const tab = tabs.get(e.tabId);
        const top = documents.get(key(e.tabId, 0));
        if (!tab?.life.ownsEditor(e.token) || !e.connected || tab.private !== e.private || top?.bindingId !== tab.documentId ||
            top.url.href !== tab.url.href) throw Error("open-editor-on-fixture");
        return tab;
    }

    async function applyAction(e: Editor, message: Fields) {
        if (!e.connected || message.type !== "action") return;
        const value = message.value;
        const {action} = message;
        // Calibration is available before a document receives a grant. Only the latest
        // popup for this tab may change it or any other setting.
        if (e.displaced && action !== "refresh") throw Error("open-editor-on-fixture");
        switch (action) {
            case "refresh": break;
            case "pause":
                if (typeof value !== "boolean") throw Error("invalid-pause");
                await persist({paused: value});
                break;
            case "renderer":
                if (value !== "marker" && value !== "candidate") throw Error("invalid-renderer");
                await persist({renderer: value});
                break;
            case "access": await persist({access: parseAccess(value)}); break;
            case "schedule": {
                if (!object(value)) throw Error("invalid-schedule");
                const s = {start: value.start, end: value.end, weekdays: value.days};
                if (!isValidSchedule(s)) throw Error("invalid-schedule");
                await persist({schedule: s});
                break;
            }
            case "calibrate": {
                if (!object(value) || !fixtureRoles.includes(value.role as FixtureRole) ||
                    !["allow", "deny", "ask"].includes(String(value.expected))) throw Error("invalid-sample");
                const c = context(e.private);
                const epoch = permissionEpoch;
                const grants = await sampleGrants();
                if (epoch !== permissionEpoch) throw Error("permission-changed");
                if (!e.connected) return;
                const sample = c.proof.record(value.role as FixtureRole, value.expected as Setting, grants);
                // Changing the calibration changes the basis for a read. Re-arm on a fresh navigation.
                for (const doc of documents.values()) if (doc.private === e.private && doc.decision?.privileged) {
                    doc.reader.invalidate();
                    doc.fingerprint = undefined;
                }
                c.calibration.push(sample);
                if (c.calibration.length > 32) c.calibration.shift();
                record(e.private, "calibration-sample", sample);
                break;
            }
            case "override": {
                const tab = requireLiveEditor(e);
                if (value !== "on" && value !== "off" && value !== "restore") throw Error("invalid-override");
                tab.life.setOverride(value === "restore" ? null : value);
                await saveOverride(tab);
                break;
            }
            case "discard": {
                const tab = requireLiveEditor(e);
                if (e.token) tab.life.closeEditor(e.token);
                e.token = tab.life.openEditor();
                break;
            }
            case "saved":
            case "preview": {
                const tab = requireLiveEditor(e);
                if (!object(value)) throw Error("invalid-edit");
                const scope = scopeFor(value.scope, tab.url);
                const edits = parseEdits(value.fields, scope, action === "preview");
                if (action === "saved") {
                    if (e.private) throw Error("private-save-unavailable");
                    await persist({saved: editSaved(settings.saved, scope, edits)});
                } else {
                    const draft: AppearanceDraft = {scope, edits: {...tab.life.preview?.edits, ...edits}};
                    if (!e.token || !tab.life.setPreview(e.token, draft)) throw Error("expired-editor");
                }
                break;
            }
            default: throw Error("unknown-action");
        }
        await refresh();
    }

    function editorConnected(port: Port) {
        if (port.sender?.id !== api.runtime.id || port.sender.url !== api.runtime.getURL("popup.html") || port.sender.tab) {
            return port.disconnect();
        }
        let e: Editor | undefined;
        let disconnected = false;
        enqueue(async () => {
            const [active] = await api.tabs.query({active: true, currentWindow: true});
            if (disconnected || active?.id === undefined || typeof active.incognito !== "boolean") return;
            for (const prior of editors) if (prior.tabId === active.id) {
                prior.token = undefined;
                prior.displaced = true;
            }
            e = {tabId: active.id, private: active.incognito, port, token: tabs.get(active.id)?.life.openEditor(), connected: true, displaced: false};
            editors.add(e);
            record(e.private, "editor-opened");
            await refresh(e.tabId);
        });
        port.onMessage.addListener(message => {
            if (!object(message)) return;
            enqueue(async () => {
                if (!e?.connected) return;
                try { await applyAction(e, message); }
                catch (error) {
                    const reason = error instanceof Error && /^[a-z-]+$/.test(error.message) ? error.message : "action-failed";
                    post(port, {type: "error", reason});
                }
            });
        });
        port.onDisconnect.addListener(() => {
            disconnected = true;
            if (!e) return;
            e.connected = false;
            editors.delete(e);
            const tab = tabs.get(e.tabId);
            if (e.token) tab?.life.closeEditor(e.token);
            record(e.private, "editor-disconnected");
            const id = e.tabId;
            enqueue(() => refresh(id));
        });
    }

    function expireEditors(tabId: number) {
        for (const editor of editors) if (editor.tabId === tabId) {
            if (editor.token) tabs.get(tabId)?.life.closeEditor(editor.token);
            editor.token = undefined;
            editor.displaced = true;
        }
    }

    function retireTab(id: number) {
        dropFrames(id, 0);
        expireEditors(id);
        tabs.get(id)?.life.close();
        tabs.delete(id);
        tabAliases.delete(id);
        for (const k of echoCounts.keys()) if (k.startsWith(`${id}/`)) echoCounts.delete(k);
        for (const [windowId, tabId] of activeTabs) if (tabId === id) activeTabs.delete(windowId);
        for (const k of arrivals.keys()) if (k.startsWith(`${id}/`)) arrivals.delete(k);
        for (const k of navigating.keys()) if (k.startsWith(`${id}/`)) navigating.delete(k);
        enqueue(() => forgetOverride(id));
    }

    function sameDocument(event: {tabId: number; frameId: number; url: string}, cause: string) {
        const {tabId, frameId} = event;
        const doc = documents.get(key(tabId, frameId));
        const url = address(event.url);
        if (!doc) return;
        observe(doc, cause, {urlChanged: doc.url.href !== event.url});
        if (doc.url.href === event.url) return;
        if (!url || doc.url.origin !== url.origin) {
            dropFrames(tabId, frameId);
            if (frameId === 0) retireTab(tabId);
            return;
        }
        doc.reader.invalidate();
        doc.url = url;
        if (frameId === 0) {
            expireEditors(tabId);
            const tab = tabs.get(tabId);
            if (tab) {
                tab.life.navigate({documentId: tab.documentId, url: url.href});
                tab.url = url;
            }
        }
        observe(doc, "same-document-navigation");
        enqueue(() => refresh(tabId));
    }

    async function runCommand(command: string) {
        const [active] = await api.tabs.query({active: true, currentWindow: true});
        if (active?.id === undefined) return;
        record(active.incognito, "command", {command: command === "toggle-tab" ? "toggle-tab" : "toggle-pause"});
        if (command === "toggle-pause") await persist({paused: !settings.paused});
        if (command === "toggle-tab") {
            const tab = tabs.get(active.id);
            const doc = documents.get(key(active.id, 0));
            if (!tab || !doc || tab.url.href !== active.url) return;
            const {data} = inputs(doc, true);
            const mode = data.tabOverride ?? data.preferences.activation;
            const on = mode === "on" || (mode === "follow-system" && data.systemDark) || (mode === "schedule" && data.scheduleActive);
            tab.life.setOverride(on ? "off" : "on");
            await saveOverride(tab);
        }
        await refresh();
    }

    // Register listeners during initial evaluation so Safari can wake either background implementation.
    api.runtime.onConnect.addListener(port => {
        if (port.name === "probe-document") contentConnected(port);
        else if (port.name === "probe-editor") editorConnected(port);
        else port.disconnect();
    });
    api.runtime.onMessage.addListener((message, sender) => {
        if (!object(message) || message.type !== "probe-echo" || sender.id !== api.runtime.id || !address(sender.url) ||
            sender.tab?.id === undefined || sender.frameId === undefined || !Number.isSafeInteger(message.id)) return;
        const phase = message.phase;
        if (phase !== undefined && phase !== "before-import" && phase !== "after-import" && phase !== "after-disable") return;
        const k = key(sender.tab.id, sender.frameId);
        const id = Number(message.id);
        const counts = echoCounts.get(k) ?? new Map<number, number>();
        const receiverCount = (counts.get(id) ?? 0) + 1;
        counts.set(id, receiverCount);
        if (counts.size > 12) counts.delete(counts.keys().next().value as number);
        echoCounts.set(k, counts);
        const owner = documents.get(k);
        if (owner) observe(owner, "ordinary-receiver", {id, phase, receiverCount});
        else record(sender.tab.incognito, "ordinary-receiver", {id, phase, receiverCount});
        return Promise.resolve({type: "probe-echo", id, phase, instance, receiverCount});
    });
    api.commands?.onCommand?.addListener(command => {
        if (command === "toggle-tab" || command === "toggle-pause") enqueue(() => runCommand(command));
    });
    api.webNavigation?.onBeforeNavigate?.addListener(({tabId, frameId, url}) => {
        const previous = documents.get(key(tabId, frameId));
        if (previous) observe(previous, "before-navigate");
        echoCounts.delete(key(tabId, frameId));
        if (frameId === 0) {
            for (const k of arrivals.keys()) if (k.startsWith(`${tabId}/`)) arrivals.delete(k);
            for (const k of navigating.keys()) if (k.startsWith(`${tabId}/`)) navigating.delete(k);
        } else arrivals.delete(key(tabId, frameId));
        if (address(url)) navigating.set(key(tabId, frameId), url);
        else navigating.delete(key(tabId, frameId));
        dropFrames(tabId, frameId);
        if (frameId === 0) expireEditors(tabId);
    });
    api.webNavigation?.onCommitted?.addListener(event => {
        const {tabId, frameId} = event;
        const url = address(event.url);
        const k = key(tabId, frameId);
        const prior = documents.get(k);
        const newId = documentId(event);
        const early = !!prior?.awaitingCommit && prior.url.href === url?.href && navigating.get(k) === url.href &&
            (!prior.documentId || !newId || prior.documentId === newId);
        const newDocument = !event.transitionQualifiers?.includes("forward_back");
        navigating.delete(k);
        if (prior) observe(prior, "navigation-committed", {browserDocumentId: !!newId});
        if (early) {
            prior.awaitingCommit = false;
            prior.fresh = newDocument;
            enqueue(() => refresh(tabId));
        } else if (!newId || newId !== prior?.documentId) dropFrames(tabId, frameId);
        arrivals.delete(k);
        if (url && !documents.has(k) && newDocument) arrivals.set(k, {url: url.href, documentId: newId});
        if (frameId !== 0) return;
        const tab = tabs.get(tabId);
        expireEditors(tabId);
        if (!url || (!early && tab && url.hostname !== tab.url.hostname)) {
            retireTab(tabId);
            if (url && !event.transitionQualifiers?.includes("forward_back")) arrivals.set(k, {url: url.href, documentId: newId});
        } else if (!tab) {
            // A sleeping background can receive a cross-host commit before a replacement port arrives.
            enqueue(async () => {
                try {
                    const item = (await api.storage.session.get(sessionKey(tabId)))[sessionKey(tabId)];
                    if (item && item.hostname !== url.hostname) await forgetOverride(tabId);
                } catch { /* No session record to recover on this build. */ }
            });
        }
    });
    api.webNavigation?.onHistoryStateUpdated?.addListener(event => sameDocument(event, "history-state"));
    api.webNavigation?.onReferenceFragmentUpdated?.addListener(event => sameDocument(event, "reference-fragment"));
    api.tabs.onCreated.addListener(tab => { if (tab.id !== undefined) retireTab(tab.id); });
    api.tabs.onRemoved.addListener(retireTab);
    api.tabs.onReplaced?.addListener((added, removed) => { retireTab(removed); retireTab(added); });
    api.tabs.onActivated.addListener(({tabId, windowId}) => {
        const prior = activeTabs.get(windowId);
        activeTabs.set(windowId, tabId);
        if (prior !== undefined && prior !== tabId) {
            expireEditors(prior);
            for (const doc of documents.values()) if (doc.tabId === prior) {
                doc.reader.invalidate();
                doc.fingerprint = undefined;
            }
        }
        enqueue(() => refresh());
    });
    for (const event of [api.permissions?.onAdded, api.permissions?.onRemoved]) {
        event?.addListener(() => {
            permissionEpoch++;
            for (const doc of documents.values()) {
                doc.reader.invalidate();
                doc.fingerprint = undefined;
                if (doc.decision) {
                    doc.decision = {...doc.decision, revision: ++revision, enabled: false, fix: false, privileged: false, reason: "permission"};
                    post(doc.port, doc.decision);
                }
            }
            enqueue(() => refresh());
        });
    }
    api.alarms?.onAlarm.addListener(alarm => {
        if (alarm.name === "wall-time") {
            for (const tab of tabs.values()) record(tab.private, "wall-time-alarm");
            enqueue(() => refresh());
        }
    });
    enqueue(async () => {
        const stored = (await api.storage.local.get(settingsKey))[settingsKey];
        if (stored !== undefined) {
            if (!object(stored) || typeof stored.paused !== "boolean" ||
                (stored.renderer !== "marker" && stored.renderer !== "candidate")) throw Error();
            const saved = readSaved(stored.saved);
            settings.access = parseAccess(stored.access);
            settings.paused = stored.paused;
            settings.renderer = stored.renderer;
            settings.saved = saved;
            // isScheduleActive rejects corrupt windows every time it resolves the current local minute.
            settings.schedule = isValidSchedule(stored.schedule) ? stored.schedule : {weekdays: [], start: "", end: ""};
        }
    }, () => { settings.paused = true; settings.access = "unknown"; });
    enqueue(async () => {
        if (api.alarms && !await api.alarms.get("wall-time")) {
            await api.alarms.create("wall-time", {periodInMinutes: 1});
        }
    }, () => record(false, "alarm-unavailable"));
}

if (typeof browser !== "undefined") registerBackground(browser);
