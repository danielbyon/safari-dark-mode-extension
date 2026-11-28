import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SCHEDULE, isValidSchedule, isScheduleActive } from "../extension/schedule.ts";

const fridayNight = { weekdays: [5], start: "22:00", end: "07:00" };
const la = "America/Los_Angeles";
const active = (spec, instant, zone = la) => isScheduleActive(spec, new Date(instant), zone);

test("overnight windows use their start weekday with inclusive start and exclusive end", () => {
  for (const [instant, expected] of [
    ["2026-11-06T21:59:59-08:00", false], ["2026-11-06T22:00:00-08:00", true],
    ["2026-11-06T22:00:01-08:00", true], ["2026-11-07T06:59:59-08:00", true],
    ["2026-11-07T07:00:00-08:00", false], ["2026-11-07T07:00:01-08:00", false],
    ["2026-11-07T22:01:00-08:00", false], ["2026-11-06T06:00:00-08:00", false],
  ]) assert.equal(active(fridayNight, instant), expected, instant);
  assert.equal(active({ ...fridayNight, weekdays: [6] }, "2026-11-08T02:00:00-08:00"), true);
});

test("missing local minutes never occur and both copies of a repeated minute are evaluated", () => {
  const spring = { weekdays: [0], start: "02:10", end: "02:45" };
  assert.equal(active(spring, "2026-03-08T09:59:59Z"), false);
  assert.equal(active(spring, "2026-03-08T10:00:00Z"), false);
  assert.equal(active({ ...spring, end: "03:15" }, "2026-03-08T10:00:00Z"), true);
  const fall = { weekdays: [0], start: "01:10", end: "01:45" };
  for (const offset of ["-07:00", "-08:00"]) {
    assert.equal(active(fall, `2026-11-01T01:10:00${offset}`), true);
    assert.equal(active(fall, `2026-11-01T01:45:00${offset}`), false);
  }
});

test("zone changes, clock corrections and resume resolve immediately from the supplied instant", () => {
  const instant = "2026-11-07T12:00:00Z";
  assert.equal(active(fridayNight, instant), true);
  assert.equal(active(fridayNight, instant, "UTC"), false);
  assert.equal(active(fridayNight, "2026-11-26T18:00:00Z"), false);
  assert.equal(active(fridayNight, instant), true);
  assert.equal(isScheduleActive(fridayNight, new Date(2026, 10, 6, 22, 0)), true);
});

test("malformed saved input cannot activate a window", () => {
  assert.equal(isValidSchedule(DEFAULT_SCHEDULE), true);
  for (const spec of [null, {}, [], { ...fridayNight, start: "07:00" },
    { ...fridayNight, start: "7:00" }, { ...fridayNight, start: "22:60" },
    { ...fridayNight, end: "24:00" }, { ...fridayNight, start: 2200 },
    { ...fridayNight, weekdays: [7] }, { ...fridayNight, weekdays: ["5"] },
    { ...fridayNight, weekdays: [] }, { ...fridayNight, weekdays: 5 }]) {
    assert.equal(isValidSchedule(spec), false);
    assert.equal(active(spec, "2026-11-07T12:00:00Z"), false);
  }
  assert.equal(active(fridayNight, "invalid instant"), false);
});
