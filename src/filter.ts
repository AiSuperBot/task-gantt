// Filter matching and group remapping (pure functions extracted from the view)
import { Task, Filter, FilterMatch, StatusDef } from "./types";
import { anchorStart, anchorEnd, statusGroupOf } from "./model";
import { dayIndex, matchDate } from "./timeline";
import { linkLabel } from "./links";

export type GroupBy = "folder" | "status" | "assignee" | "tag";

// does one unified filter match a task
export function matchFilter(t: Task, f: Filter, statuses: StatusDef[], today: number): boolean {
  if (f.kind === "date") {
    const iso = f.field === "start" ? anchorStart(t) : anchorEnd(t);
    return matchDate(iso ? dayIndex(iso) : undefined, f, today);
  }
  // text (name): case-insensitive; empty query = no effect
  if (f.kind === "text") {
    const q = f.value.trim().toLowerCase();
    if (q === "") return true;
    const name = t.name.toLowerCase();
    switch (f.op) {
      case "is": return name === q;
      case "isNot": return name !== q;
      case "contains": return name.includes(q);
      case "notContains": return !name.includes(q);
      case "startsWith": return name.startsWith(q);
      case "endsWith": return name.endsWith(q);
    }
  }
  // category: build the task's value set
  // the group is derived from the status; an unknown id or no status yields an empty set, which
  // reads as "unset" — and therefore still counts as incomplete
  const group = f.field === "statusGroup" ? statusGroupOf(statuses, t.status) : undefined;
  const vals = f.field === "attention" ? attentionOf(t, statuses, today)
    : f.field === "status" ? (t.status ? [t.status] : [])
    : f.field === "statusGroup" ? (group ? [group] : [])
      : f.field === "assignee" ? t.assignees.map(linkLabel)
        : t.tags.map((x) => x.toLowerCase()); // tags ignore case, as in Obsidian
  if (f.op === "empty") return vals.length === 0;
  if (f.op === "notEmpty") return vals.length > 0;
  // "" is the "unset" sentinel; OR within the field. People compare by display name ("Ben" and "[[Ben]]" are one person)
  const hit = f.values.some((v) => (v === "" ? vals.length === 0 : vals.includes(f.field === "assignee" ? linkLabel(v) : f.field === "tag" ? v.toLowerCase() : v)));
  return f.op === "isNot" ? !hit : hit;
}

// what needs attention (for filters): blocked (the Deferred group), overdue, urgent; finished work has none
export const ATTENTION = ["blocked", "overdue", "urgent"];
export function attentionOf(t: Task, statuses: StatusDef[], today: number): string[] {
  if (!isOpen(t, statuses)) return [];
  return [
    statusGroupOf(statuses, t.status) === "deferred" ? "blocked" : "",
    isOverdue(t, statuses, today) ? "overdue" : "",
    isUrgent(t) ? "urgent" : "",
  ].filter(Boolean);
}

// narrow tasks by filters combined with AND/OR
// a filter with nothing chosen yet (just added) filters nothing: an empty "is" would drop everything, and in "any" mode an empty name would let everything through
const isSet = (f: Filter): boolean => (f.kind === "text" ? f.value.trim() !== "" : f.kind === "category" ? f.op === "empty" || f.op === "notEmpty" || f.values.length > 0 : true);

export function applyFilters(tasks: Task[], filters: Filter[], match: FilterMatch, statuses: StatusDef[], today: number): Task[] {
  const set = filters.filter(isSet);
  if (set.length === 0) return tasks;
  return tasks.filter((t) =>
    match === "any"
      ? set.some((f) => matchFilter(t, f, statuses, today))
      : set.every((f) => matchFilter(t, f, statuses, today))
  );
}

// overdue = due before today and neither completed nor cancelled (the due date read as the Overdue preset reads it)
export function isOverdue(t: Task, statuses: StatusDef[], today: number): boolean {
  const end = anchorEnd(t);
  return !!end && dayIndex(end) < today && isOpen(t, statuses);
}

// still outstanding = neither completed nor cancelled
export function isOpen(t: Task, statuses: StatusDef[]): boolean {
  const group = statusGroupOf(statuses, t.status);
  return group !== "completed" && group !== "cancelled";
}

// urgent interrupting work = a priority of urgent / expedite / דחוף (any case); any other value (high, …) is normal work
const URGENT = new Set(["urgent", "expedite", "דחוף"]);
export function isUrgent(t: Task): boolean {
  return !!t.priority && URGENT.has(t.priority.trim().toLowerCase());
}

// started = its start (else due) is today or earlier; no dates counts as started
const started = (t: Task, today: number): boolean => {
  const s = anchorStart(t);
  return !s || dayIndex(s) <= today;
};

// interruptions and resumption are read only from urgent notes' `interrupts` (explicit links written by "Mark as urgent"); nothing is inferred, so
// urgent work without links stops nobody. While the urgent work has started and is outstanding, its targets are interrupted; once every urgent
// task linking a target is finished (completed or cancelled), the target waits to be resumed until "Resume" clears the links. If any is still
// running the target stays interrupted (overlapping interruptions). Nothing is written to the targets and their status doesn't change
export interface Interruptions {
  interrupted: Map<string, Task[]>; // interrupted task path → the urgent work still running
  resume: Map<string, Task[]>; // task path to resume → the finished urgent work (only when none still runs)
}
export function interruptions(tasks: Task[], statuses: StatusDef[], today: number): Interruptions {
  const interrupted = new Map<string, Task[]>();
  const resume = new Map<string, Task[]>();
  const add = (m: Map<string, Task[]>, p: string, u: Task) => m.set(p, [...(m.get(p) ?? []), u]);
  const byPath = new Map(tasks.map((t) => [t.path, t]));
  for (const u of tasks) {
    for (const p of u.interrupts ?? []) {
      const t = byPath.get(p);
      if (!t || t === u || !isOpen(t, statuses)) continue;
      if (!isOpen(u, statuses)) add(resume, p, u);
      else if (isUrgent(u) && started(u, today)) add(interrupted, p, u);
    }
  }
  for (const p of interrupted.keys()) resume.delete(p);
  return { interrupted, resume };
}

// candidates for "Mark as urgent": the same person's work whose status is the started status (In progress by default); To do or dates alone don't count
export function runningWorkOf(u: Task, tasks: Task[], startedId: string | undefined): Task[] {
  if (!startedId) return [];
  const people = new Set(u.assignees.map(linkLabel));
  return tasks.filter((t) => t.path !== u.path && !isUrgent(t) && t.status === startedId && t.assignees.some((a) => people.has(linkLabel(a))));
}

// a row's exceptions, strongest first; the row shows the strongest plus how many more, the details show them all
export type Exception = "urgent" | "overdue" | "blocked" | "dependency" | "interrupted" | "resume";
export const EXCEPTIONS: Exception[] = ["urgent", "overdue", "blocked", "dependency", "interrupted", "resume"];
export function exceptionsOf(t: Task, statuses: StatusDef[], today: number, conflicts: Set<string>, ints: Interruptions): Exception[] {
  if (!isOpen(t, statuses)) return [];
  const has: Record<Exception, () => boolean> = {
    urgent: () => isUrgent(t),
    overdue: () => isOverdue(t, statuses, today),
    blocked: () => statusGroupOf(statuses, t.status) === "deferred",
    dependency: () => conflicts.has(t.path),
    interrupted: () => ints.interrupted.has(t.path),
    resume: () => ints.resume.has(t.path),
  };
  return EXCEPTIONS.filter((e) => has[e]());
}

// counts over open work: all, in progress (the started status), blocked, overdue, urgent; group headings and the report count alike
export function openCounts(open: Task[], statuses: StatusDef[], today: number, startedId?: string): [number, number, number, number, number] {
  return [
    open.length,
    startedId ? open.filter((t) => t.status === startedId).length : 0,
    open.filter((t) => statusGroupOf(statuses, t.status) === "deferred").length,
    open.filter((t) => isOverdue(t, statuses, today)).length,
    open.filter(isUrgent).length,
  ];
}

// the next task to start: the earliest one starting after today (undated ones don't count)
export function nextToStart(tasks: Task[], today: number): Task | undefined {
  let best: Task | undefined;
  for (const t of tasks) {
    const s = anchorStart(t);
    if (s && dayIndex(s) > today && (!best || s < anchorStart(best)!)) best = t;
  }
  return best;
}

// a parent's summary: subtasks done / all (cancelled left out), and the next one to do (the first outstanding one in order)
export function subtaskSummary(children: Task[], statuses: StatusDef[]): { done: number; total: number; next?: Task } {
  const counted = children.filter((c) => statusGroupOf(statuses, c.status) !== "cancelled");
  return {
    done: counted.filter((c) => statusGroupOf(statuses, c.status) === "completed").length,
    total: counted.length,
    next: counted.find((c) => isOpen(c, statuses)),
  };
}

// outstanding urgent work goes first among its siblings, then work waiting to be resumed (cmp orders the rest)
export function urgentFirst(statuses: StatusDef[], cmp: (a: Task, b: Task) => number, resume: ReadonlyMap<string, unknown> = new Map()): (a: Task, b: Task) => number {
  const hot = (t: Task) => (isUrgent(t) && isOpen(t, statuses) ? 0 : resume.has(t.path) ? 1 : 2);
  return (a, b) => hot(a) - hot(b) || cmp(a, b);
}

// remap `groups` to synthetic groups for the chosen axis
// the values left after dropping the one the row's heading already shows (an assignee or a tag); heading keys are built as in regroup
// (display name for an assignee, the tag as it is). Flat rows have the heading "", so nothing is dropped
export function besideHeading(values: string[], field: "assignees" | "tags", groupBy: GroupBy, heading: string): string[] {
  if (!heading || groupBy !== (field === "assignees" ? "assignee" : "tag")) return values;
  return values.filter((v) => (field === "assignees" ? linkLabel(v) : v.toLowerCase()) !== (field === "assignees" ? heading : heading.toLowerCase()));
}

// how a tag spelled several ways is shown: always the smallest spelling (independent of order and filters)
export function tagSpelling(a: string | undefined, b: string): string {
  return a == null || b < a ? b : a;
}

export function regroup(tasks: Task[], groupBy: GroupBy, flat: boolean, statuses: StatusDef[], noneLabel: string, all: Task[] = tasks): Task[] {
  // flat ignores groups: skip remap (also avoids tag-duplicated rows)
  if (groupBy === "folder" || flat) return tasks;
  // remap groups to synthetic ones to reuse buildRows; tags and assignees are multi-valued, so a task is copied into each one's group
  const statusLabel = new Map(statuses.map((s) => [s.id, s.label]));
  // one tag heading per tag, in the first spelling seen (#Work and #work are one tag; the spelling doesn't depend on order or filters)
  const spelling = new Map<string, string>();
  for (const t of all) for (const x of t.tags) spelling.set(x.toLowerCase(), tagSpelling(spelling.get(x.toLowerCase()), x));
  return tasks.flatMap((t) => {
    const keys =
      groupBy === "status" ? (t.status ? [statusLabel.get(t.status) ?? t.status] : [])
        : groupBy === "tag" ? [...new Set(t.tags.map((x) => spelling.get(x.toLowerCase())!))]
          : [...new Set(t.assignees.map(linkLabel))];
    return (keys.length ? keys : [noneLabel]).map((key) => ({ ...t, groups: [key] }));
  });
}
