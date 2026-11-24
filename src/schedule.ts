// workday calendar, task duration, and dependency cascading (all pure functions)
import type { Task, DepType, StatusDef } from "./types";
import { dayIndex, dayToStr } from "./timeline";

// workday calendar; off = non-working weekdays (0 = Sun … 6 = Sat)
export interface WorkCalendar {
  off: number[];
}

// weekday of a day index (1970-01-01 was a Thursday)
export function weekday(day: number): number {
  return (((day + 4) % 7) + 7) % 7;
}

// a calendar with every weekday off is treated as "every day works" (avoids endless loops)
function offSet(cal: WorkCalendar): Set<number> {
  const s = new Set(cal.off);
  return s.size >= 7 ? new Set() : s;
}

// a week's first day: the first day after the days off (Monday after Sat+Sun, Sunday after Fri+Sat, Monday with none)
export function weekStart(cal: WorkCalendar): number {
  const off = offSet(cal);
  return !off.size || off.has(0) ? 1 : (Math.max(...off) + 1) % 7;
}

// up to 2.16, Sat+Sun was the default and got saved with every other setting: move just that value, once, to the new default (Fri+Sat)
export function migrateWeekend(off: number[], migrated: boolean | undefined): number[] {
  return !migrated && [...off].sort().join() === "0,6" ? [5, 6] : off;
}

// a CSS gradient shading the non-working days, repeating every week; firstDay is the day index at the timeline's left edge
export function offDayGradient(firstDay: number, cal: WorkCalendar, ppd: number, color: string): string {
  const first = weekday(firstDay);
  const stops = [...offSet(cal)]
    .map((w) => (w - first + 7) % 7)
    .sort((a, b) => a - b)
    .map((k) => `transparent ${k * ppd}px, ${color} ${k * ppd}px, ${color} ${(k + 1) * ppd}px, transparent ${(k + 1) * ppd}px`);
  // a repeating gradient's period runs from its first stop to its last, so start at 0px to make it exactly one week
  return stops.length ? `repeating-linear-gradient(to right, transparent 0px, ${stops.join(", ")}, transparent ${7 * ppd}px)` : "none";
}

export function isWorkday(day: number, cal: WorkCalendar): boolean {
  return !offSet(cal).has(weekday(day));
}

// the first workday on or after `day`
export function nextWorkday(day: number, cal: WorkCalendar): number {
  const off = offSet(cal);
  while (off.has(weekday(day))) day++;
  return day;
}

// the last workday on or before `day`
export function prevWorkday(day: number, cal: WorkCalendar): number {
  const off = offSet(cal);
  while (off.has(weekday(day))) day--;
  return day;
}

// workdays within [start, end], both ends included (0 when end < start)
export function workdaysBetween(start: number, end: number, cal: WorkCalendar): number {
  if (end < start) return 0;
  const off = offSet(cal);
  const span = end - start + 1;
  const weeks = Math.floor(span / 7);
  let n = weeks * (7 - off.size);
  for (let d = start + weeks * 7; d <= end; d++) if (!off.has(weekday(d))) n++;
  return n;
}

// the day n workdays after `day` (before it when n < 0); always lands on a workday
export function addWorkdays(day: number, n: number, cal: WorkCalendar): number {
  const off = offSet(cal);
  const step = n < 0 ? -1 : 1;
  let left = Math.abs(n);
  while (left > 0) {
    day += step;
    if (!off.has(weekday(day))) left--;
  }
  return day;
}

// the due date for an n-workday task starting on `start` (counting from the next workday if start is off; n ≥ 1)
export function endForDuration(start: number, n: number, cal: WorkCalendar): number {
  return addWorkdays(nextWorkday(start, cal), Math.max(1, n) - 1, cal);
}

// the start date back from a due date (the inverse of endForDuration)
export function startForDuration(end: number, n: number, cal: WorkCalendar): number {
  return addWorkdays(prevWorkday(end, cal), -(Math.max(1, n) - 1), cal);
}

// a task's duration in workdays: 0 for a milestone, undefined unless both dates are set
export function taskDuration(t: Pick<Task, "start" | "end" | "milestone">, cal: WorkCalendar): number | undefined {
  if (t.milestone) return 0;
  if (!t.start || !t.end) return undefined;
  return workdaysBetween(dayIndex(t.start), dayIndex(t.end), cal);
}

// parse a duration entry ("4", "4d", "4 days", "4 ימים", "4 י׳" …); null unless it's a whole number ≥ 1
export function parseDuration(raw: string): number | null {
  const m = raw.trim().match(/^(\d+)\s*[a-z\u0590-\u05FF]*$/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n >= 1 ? n : null;
}

// the due date after moving the start while keeping the duration (Wrike: changing the start moves the bar).
// a zero-workday task (sitting only on days off) keeps its calendar length instead
export function shiftEnd(oldStart: string, oldEnd: string, newStart: string, cal: WorkCalendar): string {
  const s0 = dayIndex(oldStart);
  const e0 = dayIndex(oldEnd);
  const s1 = dayIndex(newStart);
  const dur = workdaysBetween(s0, e0, cal);
  return dayToStr(dur > 0 ? endForDuration(s1, dur, cal) : s1 + (e0 - s0));
}

// apply Wrike's rule to a date edit: when only the start changed (the due date is untouched), move the due date
// too, keeping the duration. Otherwise (the due date changed, a date is unset, a milestone) keep the input as is
export function keepDurationOnStartChange(
  orig: Pick<Task, "start" | "end" | "milestone">,
  next: { start: string; end: string },
  cal: WorkCalendar
): string {
  if (orig.milestone || !orig.start || !orig.end || !next.start || !next.end) return next.end;
  if (next.start === orig.start) return next.end;
  // the range calendar drags the due date along when the new start passes it; treat that as a start-only change too
  const dragged = next.end === next.start && next.start > orig.end;
  if (next.end !== orig.end && !dragged) return next.end;
  return shiftEnd(orig.start, orig.end, next.start, cal);
}

// ----- cascading dates along dependencies -----

export interface ScheduleOptions {
  cal: WorkCalendar;
  // push FS successors (only when the predecessor now overlaps them)
  fs: boolean;
}

// build schedule options from the settings
export function scheduleOptions(s: { nonWorkingDays: number[]; autoScheduleFS: boolean }): ScheduleOptions {
  return { cal: { off: s.nonWorkingDays }, fs: s.autoScheduleFS };
}

type Span = { start?: string; end?: string };

// whether this dependency type cascades
function cascades(type: DepType, fs: boolean): boolean {
  return type === "SS" || type === "FF" || (type === "FS" && fs);
}

// whether a dependency is broken, by the cascade's own rule (align): FS starts before the workday after the predecessor's due date,
// SS starts before the predecessor starts, FF ends before it ends
export function depViolated(succ: Span & { milestone: boolean }, pred: Span & { milestone: boolean }, type: DepType, cal: WorkCalendar): boolean {
  const ss = succ.milestone ? succ.end ?? succ.start : succ.start;
  const se = succ.milestone ? succ.end ?? succ.start : succ.end ?? succ.start;
  const ps = pred.milestone ? pred.end ?? pred.start : pred.start;
  const pe = pred.milestone ? pred.end ?? pred.start : pred.end ?? pred.start;
  if (!ss || !se || !ps || !pe) return false;
  if (type === "FS") return dayIndex(ss) < nextWorkday(dayIndex(pe) + 1, cal);
  if (type === "SS") return dayIndex(ss) < dayIndex(ps);
  return dayIndex(se) < dayIndex(pe);
}

// whether adding pred → succ would close a loop (it does when pred can already be reached from succ)
export function wouldLoop(tasks: Task[], predPath: string, succPath: string): boolean {
  return predPath === succPath || successorClosure(tasks, succPath, true).includes(predPath);
}

// whether a loop can be reached from the roots along dependencies that cascade
function hasLoop(tasks: Task[], roots: string[], fs: boolean): boolean {
  const next = new Map<string, string[]>();
  for (const t of tasks) {
    for (const d of t.deps) {
      if (!cascades(d.type, fs)) continue;
      const list = next.get(d.path);
      if (list) list.push(t.path);
      else next.set(d.path, [t.path]);
    }
  }
  const state = new Map<string, "open" | "done">();
  const visit = (p: string): boolean => {
    if (state.get(p) === "open") return true;
    if (state.get(p) === "done") return false;
    state.set(p, "open");
    if ((next.get(p) ?? []).some(visit)) return true;
    state.set(p, "done");
    return false;
  };
  return roots.some(visit);
}

// successors that may be moved, transitively (excluding the root); used to pick undo snapshot targets before writing
export function successorClosure(tasks: Task[], rootPath: string, fs = false): string[] {
  const out: string[] = [];
  const seen = new Set<string>([rootPath]);
  const queue = [rootPath];
  while (queue.length) {
    const pred = queue.shift()!;
    for (const t of tasks) {
      if (seen.has(t.path)) continue;
      if (!t.deps.some((d) => d.path === pred && cascades(d.type, fs))) continue;
      seen.add(t.path);
      out.push(t.path);
      queue.push(t.path);
    }
  }
  return out;
}

// the successor's new dates against predecessor pred (null when it stays put):
//   FS: push only — if it starts before the workday after pred's due date, move it there, keeping its duration
//   SS / FF: snap to pred's start / due date (the duration is kept in workdays)
// milestones are fixed dates and never move through dependencies
function align(target: Span & { milestone: boolean }, pred: Span & { milestone: boolean }, type: DepType, cal: WorkCalendar): { start: string; end: string } | null {
  if (target.milestone || !target.start || !target.end) return null;
  const ps = pred.milestone ? pred.end ?? pred.start : pred.start;
  const pe = pred.milestone ? pred.end ?? pred.start : pred.end ?? pred.start;
  const s0 = dayIndex(target.start);
  const e0 = dayIndex(target.end);
  const dur = workdaysBetween(s0, e0, cal);
  const len = e0 - s0;
  const fromStart = (s: number) => ({ start: s, end: dur > 0 ? endForDuration(s, dur, cal) : s + len });
  const fromEnd = (e: number) => ({ start: dur > 0 ? startForDuration(e, dur, cal) : e - len, end: e });
  let next: { start: number; end: number };
  if (type === "FS") {
    if (!pe) return null;
    const earliest = nextWorkday(dayIndex(pe) + 1, cal);
    if (s0 >= earliest) return null;
    next = fromStart(earliest);
  } else if (type === "SS") {
    if (!ps) return null;
    next = fromStart(dayIndex(ps));
  } else {
    if (!pe) return null;
    next = fromEnd(dayIndex(pe));
  }
  if (next.start === s0 && next.end === e0) return null;
  return { start: dayToStr(next.start), end: dayToStr(next.end) };
}

// walk dependencies from the roots and work out new dates for successors that must move. Dependencies in a loop have no answer (each
// pass pushes further), so a loop returns null and nothing moves. `tasks` isn't mutated; the roots' own dates are taken as already updated
export function cascadeDates(tasks: Task[], roots: string[], opts: ScheduleOptions): Map<string, { start: string; end: string }> | null {
  if (hasLoop(tasks, roots, opts.fs)) return null;
  const cur = new Map<string, Span & { milestone: boolean }>(tasks.map((t) => [t.path, { start: t.start, end: t.end, milestone: t.milestone }]));
  const changes = new Map<string, { start: string; end: string }>();
  const queue = [...roots];
  // a cap on propagation even without a loop (diamond-shaped dependencies pass the same task a few times); past it, nothing moves rather than a partial result
  let guard = 20 * tasks.length + 100;
  while (queue.length) {
    if (guard-- <= 0) return null;
    const predPath = queue.shift()!;
    const pred = cur.get(predPath);
    if (!pred) continue;
    for (const succ of tasks) {
      if (succ.path === predPath) continue;
      const dep = succ.deps.find((d) => d.path === predPath);
      if (!dep || !cascades(dep.type, opts.fs)) continue;
      const span = cur.get(succ.path)!;
      const next = align(span, pred, dep.type, opts.cal);
      if (!next) continue;
      span.start = next.start;
      span.end = next.end;
      changes.set(succ.path, next);
      queue.push(succ.path);
    }
  }
  return changes;
}

// ── automatic status by date ──

// what automatic status last saw for a note (per path): its dates and status. Same dates but another status means it was set by hand (or undone),
// so it's left alone. A `pin` comes from a record up to 2.15: while the task keeps the dates recorded there, its status isn't touched
export type AutoFired = Record<string, { dates: string; status: string } | { pin: { start?: string; end?: string } }>;

// carry 2.14's `undone` and 2.15's `fired` (a date per rule) into the current shape: each becomes a pin, "leave alone while these dates stand",
// so an upgrade never rewrites a status set by hand
export function migrateAutoFired(fired: unknown, undone: unknown): AutoFired {
  const out: AutoFired = {};
  const pin = (p: string, rule: unknown, date: unknown) => {
    if (typeof date !== "string" || (rule !== "started" && rule !== "finished")) return;
    const cur = out[p];
    const prev = cur && "pin" in cur ? cur.pin : {};
    out[p] = { pin: { ...prev, [rule === "started" ? "start" : "end"]: date } };
  };
  for (const [p, r] of Object.entries((fired ?? {}) as Record<string, Record<string, unknown>>)) {
    if (typeof r?.dates === "string" && typeof r.status === "string") out[p] = { dates: r.dates, status: r.status };
    else if (r?.pin && typeof r.pin === "object") out[p] = { pin: { ...(r.pin as { start?: string; end?: string }) } };
    else for (const rule of ["started", "finished"]) pin(p, rule, r?.[rule]);
  }
  for (const [p, u] of Object.entries((undone ?? {}) as Record<string, { rule?: unknown; date?: unknown }>)) pin(p, u?.rule, u?.date);
  return out;
}

// the automatic-status setup (an empty id or list means the default)
export interface AutoStatusConfig {
  started: string;
  finished: string;
  notStarted: string[];
  fired?: AutoFired;
}

// resolve the setup against the current statuses: the started target is an active status (default in-progress, else the second active
// one), the finished target a completed status (default done, else the first completed one), and the not-started statuses active ones other
// than the started target (default: the first). A picked id that's no longer listed falls back to the default; with nothing that fits, that rule doesn't run
export function autoStatusTargets(statuses: StatusDef[], cfg: AutoStatusConfig): { started?: string; finished?: string; notStarted: string[] } {
  const active = statuses.filter((s) => s.group === "active").map((s) => s.id);
  const completed = statuses.filter((s) => s.group === "completed").map((s) => s.id);
  const started = active.includes(cfg.started) ? cfg.started : active.includes("in-progress") ? "in-progress" : active[1];
  const finished = completed.includes(cfg.finished) ? cfg.finished : completed.includes("done") ? "done" : completed[0];
  const wanted = cfg.notStarted.filter((id) => id !== started && active.includes(id));
  const firstActive = active.find((id) => id !== started);
  return { started, finished, notStarted: wanted.length ? wanted : firstActive ? [firstActive] : [] };
}

// the dates' fingerprint (the start and the due date written in the note); a due date copied from the start for drawing doesn't count
function datesOf(t: Task): string {
  return `${t.start ?? ""}|${t.endFilled ? "" : t.end ?? ""}`;
}

// the status that matches the dates (path → target and the dates' fingerprint); `today` is today in the configured timezone. Before the start:
// not started (the first not-started status); from the start through the due date (from the start on, with no due date): started; past the
// due date: finished. Tasks move back too. A status already in the matching kind (a not-started one, another active one, the completed group)
// stays. Deferred, cancelled and unknown statuses, and tasks without dates, are left alone. A note whose dates are as last seen but whose status
// differs was set by hand (or undone), so it's left alone until its dates change
export function autoStatusChanges(tasks: Task[], statuses: StatusDef[], cfg: AutoStatusConfig, today: number): Map<string, { status: string; dates: string }> {
  const { started, finished, notStarted } = autoStatusTargets(statuses, cfg);
  const group = new Map(statuses.map((s) => [s.id, s.group]));
  const out = new Map<string, { status: string; dates: string }>();
  for (const t of tasks) {
    const end = t.endFilled ? undefined : t.end;
    const from = t.start ?? end;
    if (!from) continue;
    const cur = t.status;
    const g = cur ? group.get(cur) : undefined;
    if (cur && g !== "active" && g !== "completed") continue;
    const dates = datesOf(t);
    const seen = cfg.fired?.[t.path];
    if (seen && "pin" in seen ? (!seen.pin.start || seen.pin.start === t.start) && (!seen.pin.end || seen.pin.end === end) : seen && seen.dates === dates && seen.status !== (cur ?? "")) continue;
    let want: string | undefined;
    if (end && today > dayIndex(end)) want = g === "completed" ? cur : finished;
    else if (today >= dayIndex(from)) want = g === "active" && !notStarted.includes(cur!) ? cur : started;
    else want = g === "active" && notStarted.includes(cur!) ? cur : notStarted[0];
    if (want) out.set(t.path, { status: want, dates });
  }
  return out;
}

// carry a renamed (or deleted: to = null) status id into the targets and the not-started list (cfg is updated in place)
export function renameAutoStatusId(cfg: AutoStatusConfig, from: string, to: string | null): void {
  if (!from || from === to) return;
  if (cfg.started === from) cfg.started = to ?? "";
  if (cfg.finished === from) cfg.finished = to ?? "";
  cfg.notStarted = cfg.notStarted.flatMap((id) => (id !== from ? [id] : to ? [to] : []));
  // the records too (left on the old id they read as hand edits, and those notes stop moving)
  for (const r of Object.values(cfg.fired ?? {})) if ("status" in r && r.status === from) r.status = to ?? "";
}

// the fired records whose note still exists (a record for an old date has no effect, but is kept in case the date is moved back)
export function keepAutoFired(fired: AutoFired, exists: (path: string) => boolean): AutoFired {
  return Object.fromEntries(Object.entries(fired).filter(([p]) => exists(p)));
}

// let the records follow a rename or move (a folder takes its contents along); true when any moved
export function moveAutoFired(fired: AutoFired, from: string, to: string): boolean {
  let moved = false;
  for (const p of Object.keys(fired)) {
    if (p !== from && !p.startsWith(from + "/")) continue;
    fired[to + p.slice(from.length)] = fired[p];
    delete fired[p];
    moved = true;
  }
  return moved;
}
