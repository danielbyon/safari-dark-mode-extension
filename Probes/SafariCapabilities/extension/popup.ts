import { DEFAULT_SCHEDULE, isValidSchedule } from "./schedule.ts";

const port = browser.runtime.connect({name: "probe-editor"});
const element = <T extends HTMLElement = HTMLElement>(id: string): T => {
    const node = document.getElementById(id);
    if (!node) throw new Error(`Missing popup control: ${id}`);
    return node as T;
};
const select = (id: string) => element<HTMLSelectElement>(id);
const checkbox = (id: string) => element<HTMLInputElement>(id);
const send = (action: string, value?: unknown) => port.postMessage({type: "action", action, value});
const click = (id: string, action: () => void) => element(id).addEventListener("click", action);
const scope = () => select("scope").value;

const panels = ["permissions", "rendering", "appearance", "schedule", "observations"];
for (const selected of panels) {
    click(`show-${selected}`, () => {
        for (const panel of panels) {
            element(`${panel}-panel`).hidden = panel !== selected;
            element(`show-${panel}`).setAttribute("aria-pressed", String(panel === selected));
        }
    });
}

for (const [index, name] of ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].entries()) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = `day-${index}`;
    input.checked = DEFAULT_SCHEDULE.weekdays.includes(index);
    label.append(input, name);
    element("days").append(label);
}
for (const id of ["start","end"] as const) {
    for (let minutes = 0; minutes < 24 * 60; minutes += 15) {
        const pad = (n: number) => String(n).padStart(2, "0");
        const time = `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
        select(id).add(new Option(time, time));
    }
    select(id).value = DEFAULT_SCHEDULE[id];
    select(id).addEventListener("change", protectEndpoints);
}
function protectEndpoints() {
    for (const [id, other] of [["start","end"],["end","start"]]) {
        for (const option of select(id).options) option.disabled = option.value === select(other).value;
    }
}
protectEndpoints();
const appearance = () => {
    const fields: {theme?: string | null; linkColor?: string | null} = {};
    for (const [id, field] of [["theme","theme"],["color","linkColor"]] as const) {
        const value = select(id).value;
        if (value !== "keep") fields[field] = value === "inherit" ? null : value;
    }
    return {scope: scope(), fields};
};

let previewActive = false;
for (const id of ["scope", "theme", "color"]) {
    select(id).onchange = () => {
        const scheduleOption = Array.from(select("activation").options).find(option => option.value === "schedule");
        if (scheduleOption) scheduleOption.disabled = scope() !== "global";
        if (scope() !== "global" && select("activation").value === "schedule") select("activation").value = "off";
        if (previewActive) send("preview", appearance());
    };
}

select("renderer").onchange = () => send("renderer", select("renderer").value);
select("access").onchange = () => send("access", select("access").value);
checkbox("pause").onchange = () => send("pause", checkbox("pause").checked);
click("save-activation", () => send("saved", {scope: scope(), fields: {activation: select("activation").value}}));
click("save-policy", () => send("saved", {scope: scope(), fields: {useMyTheme: checkbox("use-theme").checked}}));
click("preview", () => {
    // Keep subsequent edits in order while the first preview is crossing the runtime port.
    previewActive = true;
    send("preview", appearance());
});
click("seed", () => send("saved", appearance()));
click("discard", () => { previewActive = false; send("discard"); });
for (const mode of ["on","off","restore"]) click(`tab-${mode}`, () => send("override", mode));
click("refresh", () => send("refresh"));
for (const expected of ["allow", "deny", "ask"]) {
    click(`compare-${expected}`, () => send("calibrate", {role: select("role").value, expected}));
}
let lastSchedule = "";
click("apply-schedule", () => {
    const weekdays = [0,1,2,3,4,5,6].filter(day => checkbox(`day-${day}`).checked);
    const start = select("start").value;
    const end = select("end").value;
    if (isValidSchedule({weekdays,start,end})) send("schedule", {days: weekdays,start,end});
    else element("status").textContent = "Choose at least one start day and two distinct times.";
});

interface PopupState {
    type: "state";
    paused: boolean;
    renderer: string;
    access: string;
    private: boolean;
    preview?: object | null;
    savedRevision: number;
    decision?: { reason: string } | null;
    schedule: { days: number[]; start: string; end: string };
}

function isState(message: object): message is PopupState {
    if (!("schedule" in message) || !message.schedule || typeof message.schedule !== "object") return false;
    const schedule = message.schedule;
    return "days" in schedule && Array.isArray(schedule.days)
        && "start" in schedule && typeof schedule.start === "string"
        && "end" in schedule && typeof schedule.end === "string"
        && "type" in message && message.type === "state"
        && "renderer" in message && typeof message.renderer === "string"
        && "access" in message && typeof message.access === "string"
        && "paused" in message && typeof message.paused === "boolean"
        && "private" in message && typeof message.private === "boolean"
        && "savedRevision" in message && typeof message.savedRevision === "number";
}

// The inspector can correlate ports locally. An exported snapshot contains only fixture
// conditions, computed effects and ordered observations, without port identities or paths.
const evidenceKeys = [
    "type", "paused", "renderer", "access", "savedRevision", "decision", "reason", "enabled", "fix",
    "privileged", "revision", "inputRevision", "grants", "top", "frame", "resource", "denied", "calibration",
    "observed", "expected", "qualified", "role", "stage", "asset", "errorClass", "observations", "event", "sequence", "phase", "returned",
    "echoed", "receiverCount", "at", "ms", "readyState", "scheme", "trigger", "source", "eligible", "fresh",
    "bytes", "generation", "sheets", "rules", "hash", "opaque", "fixVersion", "mode",
    "swatchColor", "swatchBackground", "swatchBorder", "controlOutline",
    "beforeColor", "beforeBackground", "expectedColor", "expectedBackground", "afterColor", "afterBackground", "result",
];

function hideExport() {
    const link = element<HTMLAnchorElement>("export");
    link.hidden = true;
    link.removeAttribute("href");
}

port.onMessage.addListener(message => {
    if (!message || typeof message !== "object") { hideExport(); return; }
    if ("type" in message && message.type === "error" && "reason" in message) {
        hideExport();
        element("status").textContent = String(message.reason);
        return;
    }
    if (!isState(message)) { hideExport(); return; }
    previewActive = message.preview != null;
    checkbox("pause").checked = message.paused;
    select("renderer").value = message.renderer;
    select("access").value = message.access;
    for (const id of ["save-activation","save-policy","seed"]) {
        element<HTMLButtonElement>(id).disabled = message.private === true;
    }
    // Keep unsent operator input while unrelated diagnostic observations arrive.
    if (message.schedule && JSON.stringify(message.schedule) !== lastSchedule) {
        lastSchedule = JSON.stringify(message.schedule);
        for (const id of ["start","end"] as const) select(id).value = message.schedule[id];
        for (let i = 0; i < 7; i++) checkbox(`day-${i}`).checked = message.schedule.days.includes(i);
        protectEndpoints();
    }
    element("status").textContent = `${message.decision?.reason ?? "Waiting for a fixture document"} · saved revision ${message.savedRevision}`;
    element("observations").textContent = JSON.stringify(message, null, 2);
    const exportLink = element<HTMLAnchorElement>("export");
    if (message.private) hideExport();
    else {
        const snapshot = JSON.stringify(message, evidenceKeys, 2);
        exportLink.href = `data:application/json;charset=utf-8,${encodeURIComponent(snapshot)}`;
        exportLink.hidden = false;
    }
});
port.onDisconnect.addListener(() => {
    hideExport();
    element("status").textContent = "Background disconnected. Reopen the popup to reconnect.";
});
send("refresh");
