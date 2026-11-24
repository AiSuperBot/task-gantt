// Tests for the task ⇄ Google Calendar event mapping (map.ts)
import { addDays, rfc3339, eventTimes, buildEvent, fromEvent, taskHash, hasDates } from "./gcal-map.mjs";

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
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// date math
check("addDays(+1)", addDays("2026-06-30", 1) === "2026-07-01");
check("addDays(-1 across the year end)", addDays("2026-01-01", -1) === "2025-12-31");
check("addDays(leap year)", addDays("2028-02-28", 1) === "2028-02-29");

// RFC3339 with seconds
check("rfc3339(+09:00)", rfc3339("2026-06-12", "09:30", "+09:00") === "2026-06-12T09:30:00+09:00");
check("rfc3339(-05:00)", rfc3339("2026-06-12", "09:30", "-05:00") === "2026-06-12T09:30:00-05:00");

// syncable check
check("hasDates(neither date)=false", hasDates({ path: "a.md", name: "a", milestone: false }) === false);
check("hasDates(end only)=true", hasDates({ path: "a.md", name: "a", end: "2026-06-12", milestone: true }) === true);

// all-day events (exclusive end, +1 day)
const ranged = { path: "p/a.md", name: "a", start: "2026-06-12", end: "2026-06-14", milestone: false };
check(
  "eventTimes(all-day)=end+1 day",
  same(eventTimes(ranged, "+09:00"), {
    start: { date: "2026-06-12", dateTime: null },
    end: { date: "2026-06-15", dateTime: null },
  })
);

// timed only when both ends carry a time
const timed = { ...ranged, startTime: "09:00", endTime: "17:30" };
check(
  "eventTimes(timed)",
  same(eventTimes(timed, "+09:00"), {
    start: { dateTime: "2026-06-12T09:00:00+09:00", date: null },
    end: { dateTime: "2026-06-14T17:30:00+09:00", date: null },
  })
);
check(
  "eventTimes(a time on one end only)=all-day",
  same(eventTimes({ ...ranged, startTime: "09:00" }, "+09:00"), {
    start: { date: "2026-06-12", dateTime: null },
    end: { date: "2026-06-15", dateTime: null },
  })
);

// milestone = one all-day day, or the same instant when timed
const ms = { path: "p/m.md", name: "m", end: "2026-06-20", milestone: true };
check(
  "eventTimes(all-day milestone)",
  same(eventTimes(ms, "+09:00"), {
    start: { date: "2026-06-20", dateTime: null },
    end: { date: "2026-06-21", dateTime: null },
  })
);
check(
  "eventTimes(timed milestone)",
  same(eventTimes({ ...ms, endTime: "15:00" }, "+09:00"), {
    start: { dateTime: "2026-06-20T15:00:00+09:00", date: null },
    end: { dateTime: "2026-06-20T15:00:00+09:00", date: null },
  })
);

// event payload
const ev = buildEvent(timed, "+09:00", "Body excerpt", "MyVault");
check("buildEvent(summary)", ev.summary === "a");
check("buildEvent(obsidian URI)", ev.description.includes("obsidian://open?vault=MyVault&file=p%2Fa"));
check("buildEvent(the excerpt comes first)", ev.description.startsWith("Body excerpt"));
check("buildEvent(extended properties)", ev.extendedProperties.private.tgPath === "p/a.md" && ev.extendedProperties.private.tgVault === "MyVault");

// event → local (inclusive end restored)
check(
  "fromEvent(all-day)",
  same(fromEvent({ id: "x", start: { date: "2026-06-12" }, end: { date: "2026-06-15" } }, "+09:00"), {
    start: "2026-06-12",
    end: "2026-06-14",
  })
);
check(
  "fromEvent(all-day, one day)",
  same(fromEvent({ id: "x", start: { date: "2026-06-20" }, end: { date: "2026-06-21" } }, "+09:00"), {
    start: "2026-06-20",
    end: "2026-06-20",
  })
);
check(
  "fromEvent(timed, converted to the TZ)",
  same(
    fromEvent(
      { id: "x", start: { dateTime: "2026-06-12T00:00:00Z" }, end: { dateTime: "2026-06-12T08:30:00Z" } },
      "+09:00"
    ),
    { start: "2026-06-12", end: "2026-06-12", startTime: "09:00", endTime: "17:30" }
  )
);
check("fromEvent(no start)=null", fromEvent({ id: "x" }, "+09:00") === null);

// round-trip: pushing then pulling restores the same values
const rt = fromEvent({ id: "x", ...eventTimes(timed, "+09:00") }, "+09:00");
check("round-trip(timed)", same(rt, { start: "2026-06-12", end: "2026-06-14", startTime: "09:00", endTime: "17:30" }));
const rtAllDay = fromEvent({ id: "x", ...eventTimes(ranged, "+09:00") }, "+09:00");
check("round-trip(all-day)", same(rtAllDay, { start: "2026-06-12", end: "2026-06-14" }));

// fingerprint for change detection
const h = taskHash(ranged, "body");
check("taskHash(same task)", taskHash({ ...ranged }, "body") === h);
check("taskHash(changes with the dates)", taskHash({ ...ranged, end: "2026-06-15" }, "body") !== h);
check("taskHash(changes with the body)", taskHash(ranged, "body2") !== h);
check("taskHash(changes with the name)", taskHash({ ...ranged, name: "b" }, "body") !== h);

console.log(`\ngcal: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
