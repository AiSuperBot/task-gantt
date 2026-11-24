// the board (one column per status) and team (one card per person) layouts: the pure part (the screen is in view.ts)
import type { StatusDef, Task } from "./types";
import { anchorEnd, anchorStart, statusGroupOf } from "./model";
import { dayIndex } from "./timeline";
import { linkLabel } from "./links";
import { isOpen } from "./filter";

// columns: "(none)" (null, only when some card has no status), the settings' statuses in order, then statuses the settings lack
// (added on another computer, say) by name
export function boardColumns(tasks: Task[], statuses: StatusDef[]): (string | null)[] {
  const ids = statuses.map((s) => s.id);
  const unknown = [...new Set(tasks.map((t) => t.status).filter((s): s is string => !!s && !ids.includes(s)))].sort();
  return [...(tasks.some((t) => !t.status) ? [null] : []), ...ids, ...unknown];
}

// each person's tasks (a shared task under each, unassigned under `none`); `everyone` shows up even without tasks.
// Order: me first, `none` last, the rest by name; the tasks keep their given order
export function byPerson(tasks: Task[], everyone: string[], none: string, me?: string): [string, Task[]][] {
  const out = new Map<string, Task[]>(everyone.map((p) => [p, []]));
  for (const t of tasks) for (const p of t.assignees.length ? [...new Set(t.assignees.map(linkLabel))] : [none]) out.set(p, [...(out.get(p) ?? []), t]);
  const rank = (k: string) => (k === me ? 0 : k === none ? 2 : 1);
  return [...out].sort(([x], [y]) => rank(x) - rank(y) || x.localeCompare(y));
}

// a sprint note: tagged #sprint or #sprint/… (any case), or the same in Hebrew (#ספרינט); its dates are the sprint's and its name carries the goal
export function isSprint(t: Task): boolean {
  return t.tags.some((x) => /^(sprint|ספרינט)(\/|$)/i.test(x));
}

// when a card sits on the board. [from, to] is the sprint (else two weeks either side of today): finished work done (else due, when no day was
// recorded) before `from`, or undated, is "older"; open work starting after `to` is "later"; the rest "now". Only the notes' dates decide,
// so every computer agrees
export function boardWhen(t: Task, finished: boolean, from: number, to: number): "older" | "later" | "now" {
  if (finished) {
    const end = t.completed ?? anchorEnd(t);
    return !end || dayIndex(end) < from ? "older" : "now";
  }
  const start = anchorStart(t);
  return start && dayIndex(start) > to ? "later" : "now";
}

// the report's sections, each task in one only: needs attention (flagged = open work with an exception), done within the board's window,
// now (any status but the not-started ones) and next (starting before the window ends, or undated; by start). Cancelled work is left out;
// each section keeps the given order
export function reportSections(tasks: Task[], statuses: StatusDef[], notStarted: string[], flagged: (t: Task) => boolean, from: number, to: number): { attention: Task[]; done: Task[]; now: Task[]; next: Task[] } {
  const live = tasks.filter((t) => statusGroupOf(statuses, t.status) !== "cancelled");
  const open = live.filter((t) => isOpen(t, statuses));
  const calm = open.filter((t) => !flagged(t));
  const started = (t: Task) => !!t.status && !notStarted.includes(t.status);
  const at = (t: Task) => anchorStart(t) ?? "9999";
  return {
    attention: open.filter(flagged),
    done: live.filter((t) => !isOpen(t, statuses) && boardWhen(t, true, from, to) === "now"),
    now: calm.filter(started),
    next: calm.filter((t) => !started(t) && boardWhen(t, false, from, to) === "now").sort((a, b) => at(a).localeCompare(at(b))),
  };
}
