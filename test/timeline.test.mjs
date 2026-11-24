// Tests for date-filter resolution/matching and progress-line geometry
import { revealSpan, resolveDateValue, matchDate, dayIndex, dayToStr, todayIndex, progressLineX, buildProgressLine, buildTicks, buildBands, computeRange, extendChunk, extendLimit, growPad, padRange, padToCover, nearEdge, fixedOffset, formatDate } from "./timeline.mjs";

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) {
    pass++;
    console.log("  ok  -", name);
  } else {
    fail++;
    console.error("FAIL  -", name);
  }
}

// a fixed `today` day index
const TODAY = dayIndex("2026-07-19");
const idx = (iso) => dayIndex(iso);

// ── resolveDateValue ──
check("preset today", resolveDateValue({ kind: "preset", preset: "today" }, TODAY).from === TODAY);
check("preset yesterday", resolveDateValue({ kind: "preset", preset: "yesterday" }, TODAY).from === TODAY - 1);
check("preset tomorrow", resolveDateValue({ kind: "preset", preset: "tomorrow" }, TODAY).from === TODAY + 1);
check("specific", resolveDateValue({ kind: "specific", date: "2026-08-01" }, TODAY).from === idx("2026-08-01"));
check("relative 3 day fromNow", resolveDateValue({ kind: "relative", amount: 3, unit: "day", dir: "fromNow" }, TODAY).from === TODAY + 3);
check("relative 2 week ago", resolveDateValue({ kind: "relative", amount: 2, unit: "week", dir: "ago" }, TODAY).from === TODAY - 14);
// calendar month
check("relative 1 month fromNow = 8/19", resolveDateValue({ kind: "relative", amount: 1, unit: "month", dir: "fromNow" }, TODAY).from === idx("2026-08-19"));
check("relative 1 month ago = 6/19", resolveDateValue({ kind: "relative", amount: 1, unit: "month", dir: "ago" }, TODAY).from === idx("2026-06-19"));
// month carries into next year
check("relative 1 month from Jan 31 stays in Feb", resolveDateValue({ kind: "relative", amount: 1, unit: "month", dir: "fromNow" }, idx("2026-01-31")).from === idx("2026-02-28"));
check("relative 12 month fromNow = 2027-07-19", resolveDateValue({ kind: "relative", amount: 12, unit: "month", dir: "fromNow" }, TODAY).from === idx("2027-07-19"));
const range = resolveDateValue({ kind: "range", from: "2026-07-01", to: "2026-07-31" }, TODAY);
check("range both ends", range.from === idx("2026-07-01") && range.to === idx("2026-07-31"));

// ── matchDate ──
const day = (iso) => idx(iso);
const F = (op, value) => ({ field: "start", op, value });

// operator boundaries
const tom = { kind: "preset", preset: "tomorrow" }; // = TODAY+1
check("is match", matchDate(TODAY + 1, F("is", tom), TODAY) === true);
check("is no match", matchDate(TODAY, F("is", tom), TODAY) === false);
check("before true", matchDate(TODAY, F("before", tom), TODAY) === true);
check("before boundary is false", matchDate(TODAY + 1, F("before", tom), TODAY) === false);
check("after true", matchDate(TODAY + 2, F("after", tom), TODAY) === true);
check("after boundary is false", matchDate(TODAY + 1, F("after", tom), TODAY) === false);
check("onOrBefore boundary is true", matchDate(TODAY + 1, F("onOrBefore", tom), TODAY) === true);
check("onOrBefore true", matchDate(TODAY, F("onOrBefore", tom), TODAY) === true);
check("onOrBefore false", matchDate(TODAY + 2, F("onOrBefore", tom), TODAY) === false);
check("onOrAfter boundary is true", matchDate(TODAY + 1, F("onOrAfter", tom), TODAY) === true);
check("onOrAfter false", matchDate(TODAY, F("onOrAfter", tom), TODAY) === false);

// range membership
const rangeF = F("is", { kind: "range", from: "2026-07-01", to: "2026-07-31" });
check("inside the range is true", matchDate(day("2026-07-15"), rangeF, TODAY) === true);
check("range edge (from) is true", matchDate(day("2026-07-01"), rangeF, TODAY) === true);
check("range edge (to) is true", matchDate(day("2026-07-31"), rangeF, TODAY) === true);
check("outside the range is false", matchDate(day("2026-08-01"), rangeF, TODAY) === false);

// empty handling
check("empty: unset is true", matchDate(undefined, F("empty"), TODAY) === true);
check("empty: set is false", matchDate(TODAY, F("empty"), TODAY) === false);
check("notEmpty: set is true", matchDate(TODAY, F("notEmpty"), TODAY) === true);
check("notEmpty: unset is false", matchDate(undefined, F("notEmpty"), TODAY) === false);
check("an empty date is left out by before", matchDate(undefined, F("before", tom), TODAY) === false);
check("an empty date is left out by onOrAfter", matchDate(undefined, F("onOrAfter", tom), TODAY) === false);

// incomplete filter = no effect
check("no value lets everything through", matchDate(TODAY, { field: "start", op: "is" }, TODAY) === true);

// ── progress line ──
// basis at x=100, with 100px-wide bars placed around it
const BASIS = 100;
const px = (row) => progressLineX(row, BASIS);

// done never deviates
check("done (100%) is on the basis date", px({ startX: 0, width: 100, progress: 100 }) === BASIS);
check("done (over 100%) is on the basis date too", px({ startX: 0, width: 100, progress: 120 }) === BASIS);

// in-progress lands on the bar
check("50% progress is mid-bar", px({ startX: 0, width: 100, progress: 50 }) === 50);
check("50% progress right of the basis date is ahead", px({ startX: 80, width: 100, progress: 50 }) === 130);
check("25% progress is on the behind side", px({ startX: 50, width: 100, progress: 25 }) === 75);

// not started: behind to the start date if past, no deviation if future
check("not started (unset) with a past start is on the start date", px({ startX: 40, width: 100 }) === 40);
check("not started (0%) with a past start is on the start date", px({ startX: 40, width: 100, progress: 0 }) === 40);
check("not started with a future start is on the basis date", px({ startX: 160, width: 100 }) === BASIS);

// rows without a bar pass through
check("no bar passes through", px({}) === BASIS);
check("no bar (with progress) passes through too", px({ progress: 50 }) === BASIS);

// milestones (width 0): 0% sits on the diamond, 100% on the basis
check("an unreached milestone sits on its diamond", px({ startX: 30, width: 0 }) === 30);
check("a reached milestone is on the basis date", px({ startX: 30, width: 0, progress: 100 }) === BASIS);

// polyline ends pinned to basis, points at row centers
const line = buildProgressLine(
  [{ startX: 0, width: 100, progress: 50 }, {}, { startX: 40, width: 100 }],
  BASIS,
  30,
  90
);
check("polyline points = rows + 2", line.length === 5);
check("the polyline starts at the top of the basis date", line[0].x === BASIS && line[0].y === 0);
check("the polyline ends at the bottom of the basis date", line[4].x === BASIS && line[4].y === 90);
check("row 1 at its center (y=15), x=50", line[1].x === 50 && line[1].y === 15);
check("row 2 (no bar) on the basis date, y=45", line[2].x === BASIS && line[2].y === 45);
check("row 3 on its start date x=40, y=75", line[3].x === 40 && line[3].y === 75);
check("no rows still gives both ends", buildProgressLine([], BASIS, 30, 0).length === 2);

// date axis: a month start that collides with a nearby Monday wins (2026-11-01 is a Sunday, 11-02 a Monday)
const WD = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const lbl = (d, z) => (z === "Day" ? `${d.getUTCDate()} ${WD[d.getUTCDay()]}` : `${d.getUTCMonth() + 1}/${d.getUTCDate()}`);
const wk = buildTicks({ min: dayIndex("2026-10-26"), max: dayIndex("2026-11-10") }, "Week", 16, lbl);
check("week ticks: one per week on an even rhythm (10/26, 11/2, 11/9); the month band marks 11/1", wk.map((t) => t.label).join(" ") === "10/26 11/2 11/9");
check("week ticks: a week starting on the 1st is major", buildTicks({ min: dayIndex("2026-11-01"), max: dayIndex("2026-11-20") }, "Week", 16, lbl, 0).map((t) => t.major).join() === "true,false,false");
// with Fri+Sat off (a Sunday-to-Thursday week) the week ticks fall on Sundays
check("week ticks: weeks starting on Sunday (11/8, 11/15)", buildTicks({ min: dayIndex("2026-11-02"), max: dayIndex("2026-11-16") }, "Week", 16, lbl, 0).map((t) => t.label).join(" ") === "11/8 11/15");
const dayTicks = buildTicks({ min: dayIndex("2026-10-01"), max: dayIndex("2026-10-04") }, "Day", 20, lbl);
check("day ticks: too crowded days are thinned out", dayTicks.map((t) => t.label).join(" ") === "1 Th 3 Sa");
// the caller owns the format; day-month locales behave the same
const he = new Intl.DateTimeFormat("he", { day: "numeric", month: "short", timeZone: "UTC" });
// showing the opened task's bar as the detail panel opens
check("revealSpan: a bar in view stays put", revealSpan(100, 500, 200, 300, 24) === 100);
check("revealSpan: a bar the panel would hide moves just far enough", revealSpan(100, 500, 560, 640, 24) === 164);
check("revealSpan: a bar left of the view moves just far enough", revealSpan(300, 500, 200, 260, 24) === 176);
check("revealSpan: a bar longer than the view stays while it crosses it", revealSpan(100, 300, 0, 1000, 24) === 100);
check("revealSpan: a long bar out of view shows its start", revealSpan(2000, 300, 0, 1000, 24) === -24);
check("week ticks: the format is up to the label (he)", buildTicks({ min: dayIndex("2026-11-01"), max: dayIndex("2026-11-02") }, "Week", 16, (d) => he.format(d), 0)[0].label === "1 בנוב׳");

// dates read at a glance: weekday, day, month by name; the year only outside the current one
const NOV24 = dayIndex("2026-11-24");
check("glance date: this year reads 'Tue 24 Nov'", formatDate("2026-11-24", "ddd D MMM", NOV24) === "Tue 24 Nov");
check("glance date: another year drops the weekday and adds the year", formatDate("2027-01-05", "ddd D MMM", NOV24) === "5 Jan 2027");
check("numeric formats are unchanged", formatDate("2026-11-24", "YYYY/MM/DD") === "2026/11/24" && formatDate("2026-11-24", "DD/MM/YYYY") === "24/11/2026");

// the band: the current month at the left edge, then one per month
const band = buildBands({ min: dayIndex("2026-10-10"), max: dayIndex("2026-12-05") }, "Week", 16, (d) => `${d.getUTCMonth() + 1}`);
check("band: October (left edge), November, December", band.map((b) => b.label).join(" ") === "10 11 12" && band[0].x === 0 && band[1].major);
const yearBand = buildBands({ min: dayIndex("2026-11-10"), max: dayIndex("2027-02-01") }, "Month", 5, (d) => `${d.getUTCFullYear()}`);
check("band (Month): only the year breaks", yearBand.map((b) => b.label).join(" ") === "2026 2027");
const tight = buildBands({ min: dayIndex("2026-10-30"), max: dayIndex("2026-11-20") }, "Week", 16, (d) => `${d.getUTCMonth() + 1}`);
check("band: no left-edge label when the month changes right away", tight.map((b) => b.label).join(" ") === "11");

// today follows the device calendar, not UTC
check("todayIndex is the local date", [0, 30, 23 * 60 + 30].every((min) => dayToStr(todayIndex(new Date(2026, 9, 23, 0, min))) === "2026-10-23"));

// with a fixed offset, today is that zone's date whatever the device says
const instant = new Date(Date.UTC(2026, 10, 3, 20, 30)); // 2026-11-03 20:30 UTC
check("todayIndex: +09:00 is the next day", dayToStr(todayIndex(instant, "+09:00")) === "2026-11-04");
check("todayIndex: -05:00 is the same day", dayToStr(todayIndex(instant, "-05:00")) === "2026-11-03");
check("todayIndex: morning at -09:30", dayToStr(todayIndex(new Date(Date.UTC(2026, 10, 4, 5, 0)), "-09:30")) === "2026-11-03");
check("todayIndex: system follows the device calendar", todayIndex(new Date(2026, 9, 23, 23, 30), "system") === todayIndex(new Date(2026, 9, 23, 23, 30)));

// the endless timeline: chunk, limit, and the scroll fix after growing on the left
{
  const zero = { before: 0, after: 0 };
  check("extendChunk: Day 4 weeks, Week 3 months, Month 1 year, Fit none", [extendChunk("Day"), extendChunk("Week"), extendChunk("Month"), extendChunk("Fit")].join() === "28,91,365,0");
  check("growPad: one chunk, on one side only", JSON.stringify(growPad(zero, "before", "Week")) === '{"before":91,"after":0}');
  check("growPad: stops at the limit, then null", growPad({ before: extendLimit("Week") - 10, after: 0 }, "before", "Week").before === extendLimit("Week") && growPad({ before: extendLimit("Week"), after: 0 }, "before", "Week") === null);
  check("growPad: Fit doesn't grow", growPad(zero, "after", "Fit") === null);
  const base = { min: 100, max: 200 };
  check("padRange: adds before and after", JSON.stringify(padRange(base, { before: 28, after: 91 })) === '{"min":72,"max":291}');
  check("padToCover: a day outside the range (like today) comes in, with one chunk to spare", JSON.stringify(padToCover(base, zero, 500, "Day")) === '{"before":0,"after":328}' && padToCover(base, zero, 10, "Month").before === 455);
  check("padToCover: a day well inside the range changes nothing", JSON.stringify(padToCover(base, { before: 5, after: 7 }, 150, "Day")) === '{"before":5,"after":7}');
  check("padToCover: reaches past the limit (an explicit jump)", padToCover(base, zero, -5000, "Week").before > extendLimit("Week"));
  // needing 100 days to leave the edge zone adds 182 (two 91-day chunks) at once
  check("growPad: enough to leave the edge zone at once (rounded up to whole chunks)", growPad(zero, "after", "Week", 100).after === 182 && growPad(zero, "after", "Week", 0).after === 91);
  check("fixedOffset: a fixed offset in minutes, system is null", fixedOffset("+09:30") === 570 && fixedOffset("-05:00") === -300 && fixedOffset("system") === null);
  check("nearEdge: left edge, right edge, middle", nearEdge(100, 800, 5000, 800) === "before" && nearEdge(3500, 800, 5000, 800) === "after" && nearEdge(2000, 800, 5000, 800) === null);
}

// the range ignores dates more than 20 years from today (a mistyped year)
{
  const today = dayIndex("2026-11-04");
  const r = computeRange([{ start: "1025-11-01", end: "2026-11-10" }, { start: "2026-11-01", end: "3026-01-01" }], today);
  check("computeRange: dates more than 20 years away stay out of the range", dayToStr(r.min) === "2026-10-29" && dayToStr(r.max) === "2026-11-17");
  check("computeRange: around today when every date is far away", computeRange([{ start: "1025-01-01", end: "1025-01-02" }], today).min === today - 7);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
