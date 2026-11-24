// Tests for workdays, durations and dependency cascading
import {
  weekday,
  isWorkday,
  workdaysBetween,
  addWorkdays,
  endForDuration,
  startForDuration,
  taskDuration,
  parseDuration,
  shiftEnd,
  keepDurationOnStartChange,
  successorClosure,
  cascadeDates,
  depViolated,
  wouldLoop,
  offDayGradient,
  autoStatusChanges,
  autoStatusTargets,
  keepAutoFired,
  migrateAutoFired,
  migrateWeekend,
  weekStart,
  moveAutoFired,
  renameAutoStatusId,
} from "./schedule.mjs";
import { dayIndex, dayToStr } from "./timeline.mjs";

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

// 2026-08-14 is a Friday, 08-17 a Monday
const d = dayIndex;
const s = dayToStr;
const CAL = { off: [0, 6] };
const NONE = { off: [] };

// ── weekdays and workdays ──
check("weekday(Mon)=1", weekday(d("2026-08-17")) === 1);
check("weekday(1970-01-01)=Thu", weekday(0) === 4);
check("weekday(negative day index)", weekday(-1) === 3);
check("isWorkday(Sat)=false", !isWorkday(d("2026-08-15"), CAL));
check("all seven days off is ignored = every day is a workday", isWorkday(d("2026-08-15"), { off: [0, 1, 2, 3, 4, 5, 6] }));

check("workdaysBetween(Mon-Fri)=5", workdaysBetween(d("2026-08-17"), d("2026-08-21"), CAL) === 5);
check("workdaysBetween(Fri-Mon)=2", workdaysBetween(d("2026-08-14"), d("2026-08-17"), CAL) === 2);
check("workdaysBetween(Sat-Sun)=0", workdaysBetween(d("2026-08-15"), d("2026-08-16"), CAL) === 0);
check("workdaysBetween(reversed)=0", workdaysBetween(d("2026-08-17"), d("2026-08-14"), CAL) === 0);
check("workdaysBetween(3 weeks)=15", workdaysBetween(d("2026-08-17"), d("2026-09-06"), CAL) === 15);
check("workdaysBetween(no days off)=calendar days", workdaysBetween(d("2026-08-14"), d("2026-08-17"), NONE) === 4);
check("workdaysBetween(across the year end)", workdaysBetween(d("2026-12-31"), d("2027-01-04"), CAL) === 3);

check("addWorkdays(Fri+1)=Mon", s(addWorkdays(d("2026-08-14"), 1, CAL)) === "2026-08-17");
check("addWorkdays(Mon-1)=Fri", s(addWorkdays(d("2026-08-17"), -1, CAL)) === "2026-08-14");
check("addWorkdays(0)=unchanged", s(addWorkdays(d("2026-08-17"), 0, CAL)) === "2026-08-17");

// ── dates from a duration ──
check("endForDuration(Mon,4)=Thu", s(endForDuration(d("2026-08-17"), 4, CAL)) === "2026-08-20");
check("endForDuration(Fri,4)=Wed (skips the weekend)", s(endForDuration(d("2026-08-14"), 4, CAL)) === "2026-08-19");
check("endForDuration(Sat,1)=Mon (a start on a day off counts from the next workday)", s(endForDuration(d("2026-08-15"), 1, CAL)) === "2026-08-17");
check("startForDuration(Wed,4)=Fri", s(startForDuration(d("2026-08-19"), 4, CAL)) === "2026-08-14");

check("taskDuration(Mon-Thu)=4", taskDuration({ start: "2026-08-17", end: "2026-08-20", milestone: false }, CAL) === 4);
check("taskDuration(milestone)=0", taskDuration({ end: "2026-08-20", milestone: true }, CAL) === 0);
check("taskDuration(no dates)=undefined", taskDuration({ milestone: false }, CAL) === undefined);

check("parseDuration: 4", parseDuration("4") === 4);
check("parseDuration: 4d", parseDuration("4d") === 4);
check("parseDuration: 3 days", parseDuration(" 3 days") === 3);
check("parseDuration: a Hebrew unit (3 ימים, 5 י׳)", parseDuration("3 ימים") === 3 && parseDuration("5 י׳") === 5);
check("parseDuration: 0 is null", parseDuration("0") === null);
check("parseDuration: -1 is null", parseDuration("-1") === null);
check("parseDuration: 1.5 is null", parseDuration("1.5") === null);
check("parseDuration: abc is null", parseDuration("abc") === null);

// ── keeping the duration when the start moves (Wrike) ──
check("shiftEnd(Mon-Thu → starts Fri)=Wed", shiftEnd("2026-08-17", "2026-08-20", "2026-08-21", CAL) === "2026-08-26");
check("shiftEnd(a Sat-Sun-only task keeps its calendar length)", shiftEnd("2026-08-15", "2026-08-16", "2026-08-22", CAL) === "2026-08-23");
{
  const orig = { start: "2026-08-17", end: "2026-08-20", milestone: false };
  check("only the start changes → the due date moves too", keepDurationOnStartChange(orig, { start: "2026-08-21", end: "2026-08-20" }, CAL) === "2026-08-26");
  check("the due date changes too → as entered", keepDurationOnStartChange(orig, { start: "2026-08-18", end: "2026-08-19" }, CAL) === "2026-08-19");
  check("start dragged past the due date → keeps the duration", keepDurationOnStartChange(orig, { start: "2026-08-24", end: "2026-08-24" }, CAL) === "2026-08-27");
  check("start unchanged → as entered", keepDurationOnStartChange(orig, { start: "2026-08-17", end: "2026-08-25" }, CAL) === "2026-08-25");
  check("start cleared → as entered", keepDurationOnStartChange(orig, { start: "", end: "2026-08-20" }, CAL) === "2026-08-20");
  check("milestone → as entered", keepDurationOnStartChange({ end: "2026-08-20", milestone: true }, { start: "2026-08-21", end: "2026-08-20" }, CAL) === "2026-08-20");
  check("no original start → as entered", keepDurationOnStartChange({ end: "2026-08-20", milestone: false }, { start: "2026-08-10", end: "2026-08-20" }, CAL) === "2026-08-20");
}

// ── successorClosure ──
const mk = (path, o = {}) => ({ path, name: path, groups: [], deps: [], milestone: false, tags: [], custom: {}, ...o });
{
  const g = [
    mk("A"),
    mk("B", { deps: [{ path: "A", type: "SS" }] }),
    mk("C", { deps: [{ path: "B", type: "FF" }] }),
    mk("D", { deps: [{ path: "A", type: "FS" }] }),
    mk("E", { deps: [{ path: "D", type: "SS" }] }),
    mk("F", { deps: [{ path: "C", type: "SS" }, { path: "A", type: "FF" }] }), // reached twice, listed once
  ];
  g[0].deps.push({ path: "C", type: "SS" }); // a cycle
  const sorted = (xs) => JSON.stringify(xs.sort());
  check("successorClosure(FS off): SS/FF only", sorted(successorClosure(g, "A")) === sorted(["B", "C", "F"]));
  check("successorClosure(FS on): FS successors too", sorted(successorClosure(g, "A", true)) === sorted(["B", "C", "D", "E", "F"]));
  check("successorClosure: empty without successors", successorClosure(g, "F", true).length === 0);
}

// ── cascadeDates ──
const OPTS = { cal: CAL, fs: true };
{
  // the issue #4 example: the predecessor ends on a Friday, a 4-day successor
  const pred = mk("P", { start: "2026-08-10", end: "2026-08-14" });
  const succ = mk("S", { start: "2026-08-17", end: "2026-08-20", deps: [{ path: "P", type: "FS" }] });
  const next = mk("N", { start: "2026-08-21", end: "2026-08-21", deps: [{ path: "S", type: "FS" }] });
  const all = [pred, succ, next];
  check("FS: nothing moves without an overlap", cascadeDates(all, ["P"], OPTS).size === 0);

  pred.end = "2026-08-18"; // the predecessor slips to Tuesday
  const ch = cascadeDates(all, ["P"], OPTS);
  check("FS: pushes the successor to the next workday, keeping its 4 days", ch.get("S")?.start === "2026-08-19" && ch.get("S")?.end === "2026-08-24");
  check("FS: the push chains on to the next successor", ch.get("N")?.start === "2026-08-25" && ch.get("N")?.end === "2026-08-25");
  check("cascadeDates doesn't modify the tasks", succ.start === "2026-08-17");
  check("nothing moves with FS off", cascadeDates(all, ["P"], { cal: CAL, fs: false }).size === 0);

  pred.end = "2026-08-11"; // an earlier predecessor doesn't pull successors back
  check("FS: only pushes (never pulls back)", cascadeDates(all, ["P"], OPTS).size === 0);
}
{
  // a milestone predecessor on Thursday → the successor starts Friday
  const m = mk("M", { end: "2026-08-20", milestone: true });
  const succ = mk("S", { start: "2026-08-17", end: "2026-08-18", deps: [{ path: "M", type: "FS" }] });
  const ch = cascadeDates([m, succ], ["M"], OPTS);
  check("FS: a milestone predecessor", ch.get("S")?.start === "2026-08-21" && ch.get("S")?.end === "2026-08-24");
}
{
  const pred = mk("P", { start: "2026-08-19", end: "2026-08-21" });
  const ss = mk("SS", { start: "2026-08-10", end: "2026-08-12", deps: [{ path: "P", type: "SS" }] }); // 3 days
  const ff = mk("FF", { start: "2026-08-10", end: "2026-08-11", deps: [{ path: "P", type: "FF" }] }); // 2 days
  const ms = mk("MS", { end: "2026-08-10", milestone: true, deps: [{ path: "P", type: "FS" }] });
  const ch = cascadeDates([pred, ss, ff, ms], ["P"], OPTS);
  check("SS: aligns the start, keeping the duration in workdays", ch.get("SS")?.start === "2026-08-19" && ch.get("SS")?.end === "2026-08-21");
  check("FF: aligns the due date, keeping the duration in workdays", ch.get("FF")?.start === "2026-08-20" && ch.get("FF")?.end === "2026-08-21");
  check("dependencies don't move a milestone", !ch.has("MS"));
}
{
  // dependencies in a loop have no answer, so nothing moves (this used to push them 1000 times, decades ahead)
  const a = mk("A", { start: "2026-08-17", end: "2026-08-18", deps: [{ path: "B", type: "FS" }] });
  const b = mk("B", { start: "2026-08-17", end: "2026-08-18", deps: [{ path: "A", type: "FS" }] });
  check("a loop gives null (nothing moves)", cascadeDates([a, b], ["A"], OPTS) === null);
  const c = mk("C", { start: "2026-08-10", end: "2026-08-11" });
  check("wouldLoop: a loop when the successor leads back to the predecessor", wouldLoop([a, b, c], "B", "A") && wouldLoop([a, b, c], "A", "A"));
  check("wouldLoop: unrelated tasks make no loop", !wouldLoop([a, b, c], "C", "A"));
}
{
  // violations follow the cascade's rule: FS from the workday after the due date
  const p = mk("P", { start: "2026-08-10", end: "2026-08-14" }); // ends on a Friday
  const sat = mk("S", { start: "2026-08-15", end: "2026-08-17" });
  const mon = mk("M", { start: "2026-08-17", end: "2026-08-18" });
  check("depViolated FS: a Saturday start is a violation (the cascade would push it to Monday)", depViolated(sat, p, "FS", CAL) && !depViolated(mon, p, "FS", CAL));
  check("depViolated SS/FF", depViolated(mk("X", { start: "2026-08-09", end: "2026-08-20" }), p, "SS", CAL) && depViolated(mk("Y", { start: "2026-08-10", end: "2026-08-13" }), p, "FF", CAL));
}

// non-working days: from a Wednesday, Sat and Sun are the 4th and 5th days
const g = offDayGradient(dayIndex("2026-10-21"), { off: [0, 6] }, 10, "red");
check("off-day stripes: Sat (30-40px) and Sun (40-50px), repeating every 70px (from 0px)", g === "repeating-linear-gradient(to right, transparent 0px, transparent 30px, red 30px, red 40px, transparent 40px, transparent 40px, red 40px, red 50px, transparent 50px, transparent 70px)");
check("off-day stripes: none without days off", offDayGradient(0, { off: [] }, 10, "red") === "none");

// ── automatic status by date ──
{
  const ST = [
    { id: "todo", label: "To do", color: "", group: "active" },
    { id: "in-progress", label: "In progress", color: "", group: "active" },
    { id: "review", label: "Review", color: "", group: "active" },
    { id: "blocked", label: "Blocked", color: "", group: "deferred" },
    { id: "done", label: "Done", color: "", group: "completed" },
    { id: "shipped", label: "Shipped", color: "", group: "completed" },
    { id: "dropped", label: "Dropped", color: "", group: "cancelled" },
  ];
  const DEF = { started: "", finished: "", notStarted: [] };
  const today = dayIndex("2026-11-03");
  const T = (path, status, start, end, extra = {}) => ({ path, status, start, end, deps: [], ...extra });
  // only the changes (notes already right are just "seen")
  const run = (tasks, cfg = DEF, st = ST) => Object.fromEntries([...autoStatusChanges(tasks, st, cfg, today)].filter(([p, c]) => c.status !== tasks.find((t) => t.path === p).status).map(([p, c]) => [p, c.status]));
  const t = autoStatusTargets(ST, DEF);
  check("auto: the defaults are in-progress / done / the first active", t.started === "in-progress" && t.finished === "done" && t.notStarted.join() === "todo");
  check("auto: future is not started, current is started, past is done (a task due today is started)", JSON.stringify(run([T("f", "done", "2026-11-04", "2026-11-10"), T("c", "todo", "2026-11-03", "2026-11-03"), T("p", "in-progress", "2026-10-01", "2026-11-02")])) === '{"f":"todo","c":"in-progress","p":"done"}');
  check("auto: also moves back (done but starting later goes to not started, done but due later goes to started)", JSON.stringify(run([T("a", "done", "2026-11-10", "2026-11-20"), T("b", "done", "2026-11-01", "2026-11-20")])) === '{"a":"todo","b":"in-progress"}');
  check("auto: with no due date, started from the start date on (never done)", JSON.stringify(run([T("a", "todo", "2026-10-01", "2026-10-01", { endFilled: true })])) === '{"a":"in-progress"}');
  check("auto: a milestone (due date only) goes by its due date", JSON.stringify(run([T("m", "todo", undefined, "2026-11-01"), T("n", "done", undefined, "2026-11-09")])) === '{"m":"done","n":"todo"}');
  check("auto: a status already of the right kind stays (another in-progress or done status)", JSON.stringify(run([T("a", "review", "2026-11-01", "2026-11-20"), T("b", "shipped", "2026-10-01", "2026-10-02")])) === "{}");
  check("auto: leaves deferred, cancelled, unknown and undated tasks alone", JSON.stringify(run([T("a", "blocked", "2026-10-01", "2026-10-02"), T("b", "dropped", "2026-10-01", "2026-10-02"), T("c", "ghost", "2026-10-01", "2026-10-02"), T("d", "todo", undefined, undefined)])) === "{}");
  check("auto: a task with no status gets one too", JSON.stringify(run([T("a", undefined, "2026-11-10", "2026-11-12")])) === '{"a":"todo"}');
  // a status set by hand (or undone) stays until the dates change
  const fired = { a: { dates: "2026-10-01|2026-11-01", status: "done" } };
  check("auto: a status set back by hand stays", JSON.stringify(run([T("a", "in-progress", "2026-10-01", "2026-11-01")], { ...DEF, fired })) === "{}");
  check("auto: a status unchanged since it was seen follows the dates", JSON.stringify(run([T("a", "done", "2026-10-01", "2026-11-01")], { ...DEF, fired: { a: { dates: "2026-10-01|2026-11-01", status: "done" } } })) === "{}" && JSON.stringify(run([T("a", "todo", "2026-10-01", "2026-11-01")], { ...DEF, fired: { a: { dates: "2026-10-01|2026-11-01", status: "todo" } } })) === '{"a":"done"}');
  check("auto: changed dates apply the rule again", JSON.stringify(run([T("a", "in-progress", "2026-10-01", "2026-11-02")], { ...DEF, fired })) === '{"a":"done"}');
  const seen = autoStatusChanges([T("a", "review", "2026-11-01", "2026-11-20", { endFilled: false })], ST, DEF, today).get("a");
  check("auto: a task that is already right comes back too, stamped with its dates (the seen record)", seen.status === "review" && seen.dates === "2026-11-01|2026-11-20");
  const OC = [{ id: "open", label: "Open", color: "", group: "active" }, { id: "closed", label: "Closed", color: "", group: "completed" }];
  check("auto: without the built-ins, done goes to the first completed status, and with no started status nothing starts", JSON.stringify(run([T("a", "open", "2026-10-01", "2026-10-02"), T("b", "open", "2026-11-01", "2026-11-20")], DEF, OC)) === '{"a":"closed"}');
  const kept = keepAutoFired({ ...fired, gone: { dates: "|", status: "todo" } }, (p) => p !== "gone");
  check("auto: only deleted notes' records are dropped", Object.keys(kept).join() === "a");
  const mv = { "P/x.md": fired.a, "P/sub/y.md": fired.a, "Q.md": fired.a };
  check("auto: records follow renames and folder moves", moveAutoFired(mv, "P", "R") && Object.keys(mv).sort().join() === "Q.md,R/sub/y.md,R/x.md" && !moveAutoFired(mv, "none", "x"));
  const cfgR = { started: "in-progress", finished: "done", notStarted: ["todo", "review"] };
  renameAutoStatusId(cfgR, "todo", "backlog");
  renameAutoStatusId(cfgR, "done", null);
  check("auto: renaming or deleting a status id updates the settings", cfgR.notStarted.join() === "backlog,review" && cfgR.finished === "");
  const cfgF = { started: "doing", finished: "done", notStarted: [], fired: { "a.md": { dates: "x|y", status: "doing" }, "b.md": { pin: {} } } };
  renameAutoStatusId(cfgF, "doing", "active");
  check("auto: renaming an id updates the records too", cfgF.fired["a.md"].status === "active" && "pin" in cfgF.fired["b.md"]);
  check("auto: the started status never counts as not started", autoStatusTargets(ST, { started: "in-progress", finished: "", notStarted: ["in-progress", "todo"] }).notStarted.join() === "todo");
}

// the propagation cap: long chains and diamonds finish; past the cap, null rather than a partial result
{
  const n = 1500;
  const chain = Array.from({ length: n }, (_, i) => ({ path: `c${i}`, start: "2026-01-05", end: "2026-01-05", milestone: false, deps: i ? [{ path: `c${i - 1}`, type: "FS" }] : [] }));
  chain[0] = { ...chain[0], end: "2026-01-06" };
  const opts = { cal: { off: [] }, fs: true };
  const all = cascadeDates(chain, ["c0"], opts);
  check("cascade: a chain of 1500 moves all the way", all !== null && all.size === n - 1);
  // a diamond ladder (two per level, each depending on both of the level above)
  const lv = 40;
  const ladder = [{ path: "r", start: "2026-01-05", end: "2026-01-06", milestone: false, deps: [] }];
  for (let i = 0; i < lv; i++) for (const s of ["a", "b"]) ladder.push({ path: `${s}${i}`, start: "2026-01-05", end: "2026-01-05", milestone: false, deps: i ? [{ path: `a${i - 1}`, type: "FS" }, { path: `b${i - 1}`, type: "FS" }] : [{ path: "r", type: "FS" }] });
  const d = cascadeDates(ladder, ["r"], opts);
  check("cascade: a diamond ladder goes all the way too", d !== null && d.size === 2 * lv);
}

// upgrading from a 2.15.1 data.json (a date per rule) and 2.14's undone: a hand-set status stays until the task's dates change
{
  const ST = [
    { id: "todo", label: "To do", color: "", group: "active" },
    { id: "in-progress", label: "In progress", color: "", group: "active" },
    { id: "done", label: "Done", color: "", group: "completed" },
  ];
  const data = JSON.parse('{"autoStatus":{"enabled":true,"started":"","finished":"","notStarted":[],"fired":{"P/overdue.md":{"finished":"2026-11-01"},"P/both.md":{"started":"2026-10-20","finished":"2026-10-25"},"P/new.md":{"dates":"2026-11-10|","status":"todo"}},"undone":{"P/old.md":{"rule":"started","date":"2026-10-30","status":"todo"}}}}');
  const fired = migrateAutoFired(data.autoStatus.fired, data.autoStatus.undone);
  check("upgrade: 2.15 records and 2.14's undone become pins, the current shape stays", JSON.stringify(fired) === '{"P/overdue.md":{"pin":{"end":"2026-11-01"}},"P/both.md":{"pin":{"start":"2026-10-20","end":"2026-10-25"}},"P/new.md":{"dates":"2026-11-10|","status":"todo"},"P/old.md":{"pin":{"start":"2026-10-30"}}}');
  const today = dayIndex("2026-11-04");
  const T = (path, status, start, end) => ({ path, status, start, end, deps: [] });
  const cfg = { started: "", finished: "", notStarted: [], fired };
  const changed = (tasks) => Object.fromEntries([...autoStatusChanges(tasks, ST, cfg, today)].filter(([p, c]) => c.status !== tasks.find((t) => t.path === p).status).map(([p, c]) => [p, c.status]));
  // an overdue task set back to In progress, an old one left Done, one set back to To do: nothing changes while the dates are the same
  check("upgrade: while the dates match the record, a hand-set status isn't rewritten", JSON.stringify(changed([T("P/overdue.md", "in-progress", "2026-10-20", "2026-11-01"), T("P/both.md", "todo", "2026-10-20", "2026-10-25"), T("P/old.md", "todo", "2026-10-30", "2026-11-20")])) === "{}");
  check("upgrade: once the dates change, the status follows them", JSON.stringify(changed([T("P/overdue.md", "in-progress", "2026-10-20", "2026-11-02"), T("P/old.md", "todo", "2026-10-31", "2026-11-20")])) === '{"P/overdue.md":"done","P/old.md":"in-progress"}');
}

// ── a week's first day, and moving the old default (Sat+Sun) ──
check("the week starts on Monday after a Sat+Sun weekend", weekStart({ off: [0, 6] }) === 1);
check("the week starts on Sunday after a Fri+Sat weekend", weekStart({ off: [5, 6] }) === 0);
check("the week starts on Monday with no days off, or with every day off", weekStart({ off: [] }) === 1 && weekStart({ off: [0, 1, 2, 3, 4, 5, 6] }) === 1);
check("the old saved default Sat+Sun moves to Fri+Sat once", String(migrateWeekend([6, 0], undefined)) === "5,6");
check("after that, Sat+Sun picked again stays", String(migrateWeekend([0, 6], true)) === "0,6");
check("other weekends never move", String(migrateWeekend([0], undefined)) === "0" && String(migrateWeekend([5, 6], undefined)) === "5,6");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
