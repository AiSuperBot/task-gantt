import { App, CachedMetadata, TFile, TFolder, getAllTags, normalizePath } from "obsidian";
import { GanttSettings } from "./settings";
import { fmList, fmText, isBareLink, linkLabel } from "./links";
import { PALETTE } from "./colors";
import { fixedOffset } from "./timeline";
import { Task, TaskKind, Row, Dep, DepType, StatusDef, StatusGroup, CustomField, CustomFieldType, CustomValue } from "./types";

// ── status groups ──
// keywords for the migration guess (substring match on lowercased id + label), evaluated in
// order; anything unmatched lands in active. Hebrew wording is included alongside English
// ("בוצע" is done, while "בביצוע", in progress, doesn't contain it).
export const GROUP_HINTS: [StatusGroup, string[]][] = [
  ["completed", ["done", "complete", "closed", "finish", "resolved", "בוצע", "הושלם", "הסתיים", "סגור", "נסגר"]],
  ["cancelled", ["cancel", "reject", "dropped", "abandon", "בוטל", "ביטול", "מבוטל", "לא רלוונטי"]],
  ["deferred", ["defer", "hold", "pending", "paused", "block", "waiting", "חסום", "ממתין", "המתנה", "מושה", "הושהה", "תקוע", "מעוכב", "דחוי"]],
];

// guess a group for a pre-upgrade status
export function inferStatusGroup(id: string, label: string): StatusGroup {
  const hay = `${id} ${label}`.toLowerCase();
  for (const [group, words] of GROUP_HINTS) {
    if (words.some((w) => hay.includes(w))) return group;
  }
  return "active";
}

// the group a task's status belongs to; unset or unknown ids yield undefined rather than being
// folded into "completed" — guessing there would make the completed filter lie
export function statusGroupOf(statuses: StatusDef[], status?: string): StatusGroup | undefined {
  if (!status) return undefined;
  return statuses.find((s) => s.id === status)?.group;
}

// why a custom field can't become a column
export type CustomFieldIssue = "empty" | "reserved" | "duplicate";

// check each custom field: an empty key, a key the plugin already reads (the configured built-in keys and
// `tags`), or a key an earlier field already uses keeps it from becoming a column
export function customFieldIssues(settings: GanttSettings): Map<string, CustomFieldIssue> {
  const reserved = new Set([...Object.values(settings.keys), "tags"]);
  const seen = new Set<string>();
  const out = new Map<string, CustomFieldIssue>();
  for (const f of settings.customFields ?? []) {
    const key = f.key.trim();
    if (!key) out.set(f.id, "empty");
    else if (reserved.has(key)) out.set(f.id, "reserved");
    else if (seen.has(key)) out.set(f.id, "duplicate");
    seen.add(key);
  }
  return out;
}

// the custom fields that can be columns, in definition order
export function validCustomFields(settings: GanttSettings): CustomField[] {
  const issues = customFieldIssues(settings);
  return (settings.customFields ?? []).filter((f) => !issues.has(f.id));
}

// read a raw frontmatter value as the field's type; unreadable or empty gives undefined
export function readCustomValue(raw: unknown, type: CustomFieldType, tz: string): CustomValue | undefined {
  if (raw == null || raw === "") return undefined;
  if (type === "number") {
    const n = typeof raw === "number" ? raw : Number(String(raw).trim());
    return Number.isFinite(n) ? n : undefined;
  }
  if (type === "date") return parseStored(raw, tz)?.date; // the date part only
  if (Array.isArray(raw)) {
    const list = (raw as unknown[]).filter((x) => x != null && x !== "").map((x) => String(x));
    return list.length ? list : undefined;
  }
  return String(raw);
}

// display text (a list is comma-joined)
export function customValueText(v: CustomValue | undefined): string {
  if (v == null) return "";
  return Array.isArray(v) ? v.join(", ") : String(v);
}

// turn an input string into the value to write: blank deletes (undefined); a text field that held a list is split
// back into a list on commas; a number field given a non-number yields null (= don't write)
export function parseCustomInput(input: string, type: CustomFieldType, wasList: boolean): CustomValue | undefined | null {
  const v = input.trim();
  if (v === "") return undefined;
  if (type === "number") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (type === "text" && wasList) {
    const list = v.split(",").map((x) => x.trim()).filter((x) => x !== "");
    return list.length ? list : undefined;
  }
  return v;
}

// notes whose frontmatter has the key (whole vault)
export function filesWithFrontmatterKey(app: App, key: string): TFile[] {
  if (!key) return [];
  return app.vault.getMarkdownFiles().filter((f) => {
    const fm = app.metadataCache.getFileCache(f)?.frontmatter;
    return !!fm && Object.prototype.hasOwnProperty.call(fm, key);
  });
}

// rename a frontmatter key (moves notes along with a custom field's key change); a note that already
// has a value under the new key is skipped rather than overwritten
export async function renameFrontmatterKey(
  app: App,
  files: TFile[],
  oldKey: string,
  newKey: string
): Promise<{ renamed: number; skipped: number }> {
  let renamed = 0;
  let skipped = 0;
  for (const file of files) {
    await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
      if (!Object.prototype.hasOwnProperty.call(fm, oldKey)) return;
      const cur = fm[newKey];
      if (cur != null && cur !== "") {
        skipped++;
        return;
      }
      fm[newKey] = fm[oldKey];
      delete fm[oldKey];
      renamed++;
    });
  }
  return { renamed, skipped };
}

// split a raw `after` entry into type + link
function parseDepRaw(raw: string): { type: DepType; link: string } {
  const m = raw.match(/^\s*(FS|SS|FF)\s*:\s*(.*)$/i);
  if (m) return { type: m[1].toUpperCase() as DepType, link: m[2].trim() };
  return { type: "FS", link: raw.trim() };
}

// strip the type prefix, keep the link
function stripDepType(raw: unknown): string {
  return String(raw).replace(/^\s*(FS|SS|FF)\s*:\s*/i, "");
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

// configured timezone offset in minutes; "system" = device offset at that instant (DST-aware)
function offsetMinutes(tz: string, instantMs: number): number {
  return fixedOffset(tz) ?? -new Date(instantMs).getTimezoneOffset();
}

// the offset (minutes) at a wall-clock date + time; "system" = the device's offset at that wall time (DST-aware)
function wallOffset(tz: string, date: string, time: string): number {
  return fixedOffset(tz) ?? -new Date(`${date}T${time}`).getTimezoneOffset();
}

// minutes to a "+09:00" suffix
function offsetSuffix(min: number): string {
  const a = Math.abs(min);
  return `${min < 0 ? "-" : "+"}${pad2(Math.floor(a / 60))}:${pad2(a % 60)}`;
}

// parse a stored value into display date + time: zoned values convert to the configured tz,
// naive values pass through, non-date values (e.g. "TBD") become undefined
export function parseStored(v: unknown, tz: string): { date: string; time?: string } | undefined {
  if (v == null || v === "") return undefined;
  if (v instanceof Date) v = v.toISOString();
  const m = String(v)
    .trim()
    .match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*(Z|z|[+-]\d{2}:?\d{2})?)?/);
  if (!m) return undefined;
  const [, date, h, mi, zone] = m;
  if (h == null) return { date };
  const hh = +h;
  const mm = +mi;
  if (hh > 23 || mm > 59) return { date }; // invalid time → date only
  if (!zone) return { date, time: `${pad2(hh)}:${pad2(mm)}` };
  const zu = zone.toUpperCase();
  const zMin = zu === "Z" ? 0 : (zu[0] === "-" ? -1 : 1) * (+zu.slice(1, 3) * 60 + +zu.replace(":", "").slice(-2));
  const [y, mo, d] = date.split("-").map(Number);
  const instant = Date.UTC(y, mo - 1, d, hh, mm) - zMin * 60000;
  const disp = new Date(instant + offsetMinutes(tz, instant) * 60000).toISOString();
  return { date: disp.slice(0, 10), time: disp.slice(11, 16) };
}

// wall-clock date + time in the configured tz → absolute epoch ms (used for notification triggers)
export function toInstant(date: string, time: string, tz: string): number {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  return naive - wallOffset(tz, date, time) * 60000;
}

// combine display date + time into the stored value (a time gets the configured tz offset appended)
export function combineDateTime(date: string | undefined, time: string | undefined, tz: string): string | undefined {
  if (!date) return undefined;
  if (!time) return date;
  return `${date}T${time}${offsetSuffix(wallOffset(tz, date, time))}`;
}

// normalize a frontmatter `tags` value into a string array (array / comma / space separated, # stripped)
function normalizeTags(v: unknown): string[] {
  if (v == null) return [];
  const raw = Array.isArray(v) ? v.map((x) => String(x)) : String(v).split(/[,\s]+/);
  return raw.map((x) => x.replace(/^#/, "").trim()).filter(Boolean);
}

// resolve a wikilink, markdown link, or raw path
function resolveLink(app: App, raw: string, sourcePath: string): TFile | null {
  let inner = raw.trim();
  const md = inner.match(/\]\(([^)]+)\)/); // [text](path)
  if (md) {
    try {
      inner = decodeURIComponent(md[1]);
    } catch {
      inner = md[1]; // a broken %-escape ("50% plan") is used as typed
    }
  }
  else inner = inner.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0];
  inner = inner.split("#")[0].trim();
  return app.metadataCache.getFirstLinkpathDest(inner, sourcePath);
}

// collect tasks under a scoped folder
export function collectTasks(app: App, settings: GanttSettings, folderPath: string): Task[] {
  const rootPath = normalizePath(folderPath || "/");
  const root =
    rootPath === "/" ? app.vault.getRoot() : app.vault.getAbstractFileByPath(rootPath);
  if (!(root instanceof TFolder)) return [];
  const isVaultRoot = root === app.vault.getRoot();

  const files: TFile[] = [];
  const walk = (folder: TFolder) => {
    for (const child of folder.children) {
      if (child instanceof TFile && child.extension === "md") files.push(child);
      else if (child instanceof TFolder && settings.recurse) walk(child);
    }
  };
  walk(root);

  const k = settings.keys;
  const fields = validCustomFields(settings);
  const rawAfter = new Map<string, string[]>(); // raw after entries
  const rawInterrupts = new Map<string, string[]>(); // raw interrupts entries
  const rawParent = new Map<string, string>(); // raw parent link
  const tasks: Task[] = files.map((file) => {
    const cache = app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter ?? {};
    // merge frontmatter + inline tags, strip #, dedupe
    const tags = cache ? [...new Set((getAllTags(cache) ?? []).map((x) => x.replace(/^#/, "")))] : [];
    // folder chain relative to the scope (without filename)
    const rel = isVaultRoot ? file.path : file.path.slice(rootPath.length + 1);
    const segs = rel.split("/");
    const groups = segs.slice(0, -1);

    const ps = parseStored(fm[k.start], settings.tz);
    const pe = parseStored(fm[k.end], settings.tz);
    const start = ps?.date;
    let end = pe?.date;
    // milestone = only the due date, or explicit flag
    const milestone = fm[k.milestone] === true || (!!end && !start);
    // "start only" isn't valid: mirror end = start
    const endFilled = !!start && !end;
    if (endFilled) end = start;

    rawAfter.set(file.path, fmList(fm[k.after]));
    rawInterrupts.set(file.path, fmList(fm[k.interrupts]));
    // coerce parent via unknown (avoid unsafe any)
    const pv: unknown = fm[k.parent];
    if (pv != null && pv !== "") {
      const link = Array.isArray(pv) ? (pv as unknown[])[0] : pv;
      rawParent.set(file.path, String(link));
    }
    // custom fields (only those with a value)
    const custom: Record<string, CustomValue> = {};
    for (const f of fields) {
      const v = readCustomValue(fm[f.key.trim()], f.type, settings.tz);
      if (v !== undefined) custom[f.id] = v;
    }
    // kind: the Kanban plugin's marker, or a link to a .canvas
    const cv = fmText(fm[k.canvas]);
    const canvas = cv ? resolveLink(app, cv, file.path) : null;
    const kind: TaskKind = fm["kanban-plugin"] ? "kanban" : canvas?.extension === "canvas" ? "canvas" : "note";
    // a kanban's progress is the share of checked cards, counted by kanbanLanes, the same rule the detail panel's lanes use
    const all = kind === "kanban" ? kanbanLanes(cache).flatMap((l) => l.cards) : [];
    const cards = all.length ? { done: all.filter((c) => c.done).length, total: all.length } : undefined;
    return {
      path: file.path,
      name: file.basename,
      groups,
      start,
      end,
      startTime: ps?.time,
      endTime: pe?.time,
      endFilled: endFilled || undefined,
      priority: fmText(fm[k.priority]) || undefined,
      status: fm[k.status] != null ? String(fm[k.status]) : undefined,
      completed: parseStored(fm[k.completed], settings.tz)?.date,
      blocker: fmText(fm[k.blocker]) || undefined,
      assignees: fmList(fm[k.assignee]),
      kind,
      canvas: kind === "canvas" ? canvas?.path : undefined,
      deps: [] as Dep[],
      progress: cards ? cardProgress(cards.done, cards.total) : finite(parseFloat(String(fm[k.progress] ?? ""))), // "50%" reads as 50; not a number reads as none
      cards,
      milestone,
      parent: undefined,
      tags,
      custom,
    };
  });

  // resolve typed dependencies to paths
  const byPath = new Map(tasks.map((t) => [t.path, t]));
  for (const t of tasks) {
    for (const raw of rawAfter.get(t.path) ?? []) {
      const { type, link } = parseDepRaw(raw);
      const dest = resolveLink(app, link, t.path);
      if (dest && byPath.has(dest.path)) t.deps.push({ path: dest.path, type });
    }
    // what it interrupted (only links that resolve)
    const ints = (rawInterrupts.get(t.path) ?? []).map((raw) => resolveLink(app, raw, t.path)?.path).filter((p): p is string => !!p && p !== t.path);
    if (ints.length) t.interrupts = ints;
    // resolve parent (unresolved = treated as top-level)
    const rp = rawParent.get(t.path);
    if (rp) {
      const dest = resolveLink(app, rp, t.path);
      if (dest && dest.path !== t.path && byPath.has(dest.path)) t.parent = dest.path;
    }
  }
  return tasks;
}

// collect all subfolders under the scope as relative segment arrays (used to show empty folders)
export function collectFolders(app: App, settings: GanttSettings, folderPath: string): string[][] {
  if (!settings.recurse) return []; // no grouping when not recursing
  const rootPath = normalizePath(folderPath || "/");
  const root =
    rootPath === "/" ? app.vault.getRoot() : app.vault.getAbstractFileByPath(rootPath);
  if (!(root instanceof TFolder)) return [];
  const isVaultRoot = root === app.vault.getRoot();
  const out: string[][] = [];
  const walk = (folder: TFolder) => {
    for (const child of folder.children) {
      if (!(child instanceof TFolder)) continue;
      const rel = isVaultRoot ? child.path : child.path.slice(rootPath.length + 1);
      out.push(rel.split("/"));
      walk(child);
    }
  };
  walk(root);
  return out;
}

// task anchor dates (milestone collapses to its due date)
export function anchorStart(t: Task): string | undefined {
  return t.milestone ? t.end ?? t.start : t.start;
}
export function anchorEnd(t: Task): string | undefined {
  return t.milestone ? t.end ?? t.start : t.end ?? t.start;
}

// folder tree node
interface TreeNode {
  name: string;
  folders: Map<string, TreeNode>;
  tasks: Task[];
}

// all descendant tasks
function descendantTasks(node: TreeNode): Task[] {
  const out = [...node.tasks];
  for (const c of node.folders.values()) out.push(...descendantTasks(c));
  return out;
}

// compute the rolled-up span
function spanOf(tasks: Task[]): { start: string; end: string } | undefined {
  const starts = tasks.map(anchorStart).filter((d): d is string => !!d).sort();
  const ends = tasks.map(anchorEnd).filter((d): d is string => !!d).sort();
  return starts.length && ends.length ? { start: starts[0], end: ends[ends.length - 1] } : undefined;
}

// re-point a list of paths after a rename or move (a folder takes its contents along)
export function movePaths(paths: string[], from: string, to: string): string[] {
  return paths.map((p) => (p === from || p.startsWith(from + "/") ? to + p.slice(from.length) : p));
}

// flatten the folder tree into nested rows (collapsed folders hide their children)
// default task order = start ascending
const defaultTaskCompare = (a: Task, b: Task): number =>
  (anchorStart(a) ?? "9999").localeCompare(anchorStart(b) ?? "9999");

export function buildRows(
  tasks: Task[],
  collapsed: Set<string> = new Set(),
  folders: string[][] = [],
  taskCompare: (a: Task, b: Task) => number = defaultTaskCompare,
  nest = false // nest by parent (folder grouping only)
): Row[] {
  const root: TreeNode = { name: "", folders: new Map(), tasks: [] };
  // seed nodes for (possibly empty) folders first, so a folder shows even with no tasks
  for (const chain of folders) {
    let node = root;
    for (const g of chain) {
      if (!g) continue;
      if (!node.folders.has(g)) node.folders.set(g, { name: g, folders: new Map(), tasks: [] });
      node = node.folders.get(g)!;
    }
  }
  for (const t of tasks) {
    let node = root;
    for (const g of t.groups) {
      if (!node.folders.has(g)) node.folders.set(g, { name: g, folders: new Map(), tasks: [] });
      node = node.folders.get(g)!;
    }
    node.tasks.push(t);
  }

  const rows: Row[] = [];
  const walk = (node: TreeNode, depth: number, prefix: string) => {
    // direct tasks first, then subfolders by name; the other way round a folder's own tasks read as part of the subfolder above them
    placeTasks(node, depth);
    for (const name of [...node.folders.keys()].sort((a, b) => a.localeCompare(b))) {
      const child = node.folders.get(name)!;
      const key = prefix ? `${prefix}/${name}` : name;
      const under = descendantTasks(child);
      rows.push({ kind: "group", group: name, depth, key, span: spanOf(under), tasks: under });
      if (!collapsed.has(key)) walk(child, depth + 1, key);
    }
  };
  // place direct tasks (a parent forest when nesting)
  const placeTasks = (node: TreeNode, depth: number) => {
    if (!nest) {
      for (const task of node.tasks.slice().sort(taskCompare)) rows.push({ kind: "task", group: node.name, depth, task });
      return;
    }
    // ── nest by parent within this folder ──
    const paths = new Set(node.tasks.map((t) => t.path));
    const kids = new Map<string, Task[]>();
    for (const t of node.tasks) {
      if (!t.parent || !paths.has(t.parent)) continue;
      const list = kids.get(t.parent);
      if (list) list.push(t);
      else kids.set(t.parent, [t]);
    }
    for (const list of kids.values()) list.sort(taskCompare);
    const childrenOf = (p: string): Task[] => kids.get(p) ?? [];
    // self + descendants span (for rollup)
    const subtree = (t: Task, seen: Set<string>): Task[] => {
      if (seen.has(t.path)) return [];
      seen.add(t.path);
      const out = [t];
      for (const c of childrenOf(t.path)) out.push(...subtree(c, seen));
      return out;
    };
    // roots = no parent or parent not in this folder
    const roots = node.tasks.filter((t) => !t.parent || !paths.has(t.parent)).sort(taskCompare);
    // tasks that belong to the forest (ignoring collapse)
    const reachable = new Set<string>();
    const mark = (p: string) => {
      if (reachable.has(p)) return;
      reachable.add(p);
      for (const c of childrenOf(p)) mark(c.path);
    };
    for (const r of roots) mark(r.path);

    const emitted = new Set<string>();
    const emit = (task: Task, d: number, sub = false) => {
      if (emitted.has(task.path)) return; // dup guard
      emitted.add(task.path);
      const children = childrenOf(task.path);
      const has = children.length > 0;
      const span = has ? spanOf(subtree(task, new Set())) : undefined;
      rows.push({ kind: "task", group: node.name, depth: d, task, key: has ? task.path : undefined, span, hasChildren: has, sub: sub || undefined });
      // hide children while collapsed
      if (has && !collapsed.has(task.path)) for (const c of children) emit(c, d + 1, true);
    };
    for (const r of roots) emit(r, depth);
    // surface only cycle-orphaned tasks
    for (const t of node.tasks.filter((x) => !reachable.has(x.path)).sort(taskCompare)) emit(t, depth);
  };
  walk(root, 0, "");
  return rows;
}

// write back start/end into frontmatter
export async function writeDates(
  app: App,
  settings: GanttSettings,
  path: string,
  start: string,
  end: string,
  milestone: boolean
): Promise<void> {
  const file = noteAt(app, path);
  const k = settings.keys;
  await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
    // carry the displayed time-of-day over to the new date (re-normalizing the offset to the configured tz)
    const ts = parseStored(fm[k.start], settings.tz)?.time;
    const te = parseStored(fm[k.end], settings.tz)?.time;
    if (milestone) {
      // milestone keeps only the due date
      fm[k.end] = combineDateTime(end, te, settings.tz);
      delete fm[k.start];
    } else {
      fm[k.start] = combineDateTime(start, ts, settings.tz);
      // moving a task with no due date doesn't add one (it stays a start-only day)
      if (fm[k.end] != null || start !== end) fm[k.end] = combineDateTime(end, te, settings.tz);
    }
  });
}

// write back an arbitrary frontmatter value
// set the status; entering the Completed group records the day, moving between completed statuses keeps it and leaving clears it. It is
// the same write, so every computer reads the same day (a file's modified time is when sync delivered it). Leaving the Deferred group
// clears the blocker reason too: once unblocked, it no longer says anything true. A reason on a note that wasn't deferred (written by
// hand or by another tool) is not this write's to remove
export function applyStatus(fm: Record<string, unknown>, keys: { status: string; completed: string; blocker: string }, statuses: StatusDef[], id: string | undefined, today: string): void {
  const before = statusGroupOf(statuses, fm[keys.status] == null ? undefined : String(fm[keys.status]));
  const was = before === "completed";
  if (id) fm[keys.status] = id;
  else delete fm[keys.status];
  if (before === "deferred" && statusGroupOf(statuses, id) !== "deferred") delete fm[keys.blocker];
  if (statusGroupOf(statuses, id) !== "completed") delete fm[keys.completed];
  else if (!was || fm[keys.completed] == null) fm[keys.completed] = today;
}

export async function writeStatus(app: App, path: string, settings: Pick<GanttSettings, "keys" | "statuses">, id: string | undefined, today: string): Promise<void> {
  await app.fileManager.processFrontMatter(noteAt(app, path), (fm: Record<string, unknown>) => applyStatus(fm, settings.keys, settings.statuses, id, today));
}

export async function writeField(
  app: App,
  path: string,
  key: string,
  value: unknown
): Promise<void> {
  const file = noteAt(app, path);
  await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
    if (value == null || value === "") delete fm[key];
    else fm[key] = value;
  });
}

// write a multi-valued field (assignees): none deletes it; a single value stays a plain value unless it was a list already
export async function editListField(app: App, path: string, key: string, value: string, add: boolean): Promise<void> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return;
  await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
    const next = listWith(fm[key], value, add);
    if (next === null) delete fm[key];
    else if (next !== undefined) fm[key] = next;
  });
}

// the value after adding or removing one entry of a multi-valued property (undefined: no change, null: now empty). People compare by
// display name, so "Ben" and "[[Ben]]" are one person. Other entries stay as written, a list stays a list and a single value stays single
export function listWith(raw: unknown, value: string, add: boolean): unknown {
  const wasList = Array.isArray(raw) && !isBareLink(raw);
  // an unquoted [[x]] is a nested array to YAML: write it back as "[[x]]"
  const items = (raw == null || raw === "" ? [] : wasList ? (raw as unknown[]) : [raw]).map((x) => (isBareLink(x) ? fmText(x) : x));
  const same = (x: unknown) => linkLabel(fmText(x)?.trim() ?? "") === linkLabel(value);
  if (add === items.some(same)) return undefined;
  const next = add ? [...items, value] : items.filter((x) => !same(x));
  return next.length === 0 ? null : next.length > 1 || wasList ? next : next[0];
}

// read the body (without frontmatter)
export async function readBody(app: App, path: string): Promise<string> {
  const file = app.vault.getAbstractFileByPath(path);
  return file instanceof TFile ? bodyOf(await app.vault.cachedRead(file)) : "";
}

// a note's body: its text without the leading frontmatter block
export function bodyOf(text: string): string {
  return text.replace(FRONTMATTER, "").replace(/^(?:[ \t]*\r?\n)+/, "").trimEnd();
}

// the leading frontmatter block (an empty "---\n---" too)
const FRONTMATTER = /^---\r?\n(?:[\s\S]*?\r?\n)?---(?:\r?\n|$)/;

// a note's text with its body replaced and its frontmatter kept (no blank line added after the frontmatter)
export function withBody(text: string, body: string): string {
  const m = text.match(FRONTMATTER);
  const fm = !m ? "" : m[0].endsWith("\n") ? m[0] : m[0] + "\n";
  const trimmed = body.replace(/\s+$/, "");
  return fm + (trimmed ? trimmed + "\n" : "");
}

// write back the body (keeping frontmatter)
export async function writeBody(app: App, path: string, body: string): Promise<void> {
  await app.vault.process(noteAt(app, path), (text) => withBody(text, body));
}

// the note to write to; throws when it's gone (never a silent no-op: mutate then says the write failed)
function noteAt(app: App, path: string): TFile {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) throw new Error(`Note not found: ${path}`);
  return file;
}

// undefined when not a number
const finite = (n: number): number | undefined => (Number.isFinite(n) ? n : undefined);

// drop only the links to `target` from a link list (interrupts and the like); links that don't resolve (a note not synced yet) stay
export async function removeLinkTo(app: App, path: string, key: string, target: string): Promise<void> {
  await app.fileManager.processFrontMatter(noteAt(app, path), (fm: Record<string, unknown>) => {
    if (fm[key] == null) return;
    const rest = fmList(fm[key]).filter((raw) => resolveLink(app, raw, path)?.path !== target);
    if (rest.length) fm[key] = rest;
    else delete fm[key];
  });
}

// create a new task in the folder and return the paths made (the note first); a clashing name gets a counter.
// A kanban gets one lane per status in the Kanban plugin's format; a canvas gets a same-named .canvas, linked and embedded
export async function createTask(app: App, settings: GanttSettings, folderPath: string, baseName: string, kind: TaskKind = "note"): Promise<string[]> {
  const dir = normalizePath(folderPath || "/");
  const prefix = dir === "/" ? "" : dir + "/";
  // ask the file system (Windows ignores case)
  const taken = async (n: string) => (await app.vault.adapter.exists(`${prefix}${n}.md`)) || (kind === "canvas" && (await app.vault.adapter.exists(`${prefix}${n}.canvas`)));
  let name = baseName;
  let i = 1;
  while (await taken(name)) name = `${baseName} ${++i}`;
  const md = `${prefix}${name}.md`;
  // caller fills start/end
  if (kind === "kanban") {
    await app.vault.create(md, `---\nkanban-plugin: board\n---\n\n${settings.statuses.map((s) => `## ${s.label}\n\n`).join("\n")}`);
    return [md];
  }
  if (kind !== "canvas") {
    await app.vault.create(md, await templateText(app, settings.taskTemplate));
    return [md];
  }
  const cv = await app.vault.create(`${prefix}${name}.canvas`, JSON.stringify({ nodes: [], edges: [] }));
  // the frontmatter link is a wikilink (Obsidian keeps those updated on rename); the key is configurable, so the API writes the YAML
  const link = `[[${app.metadataCache.fileToLinktext(cv, md, false)}]]`;
  let note: TFile | null = null;
  try {
    note = await app.vault.create(md, `!${link}\n`);
    await app.fileManager.processFrontMatter(note, (fm: Record<string, unknown>) => { fm[settings.keys.canvas] = link; });
  } catch (e) {
    // when the note can't be made, delete the canvas (and note) made here: they'd be left behind, outside the undo record
    for (const f of [note, cv]) if (f) await app.vault.delete(f);
    throw e;
  }
  return [md, cv.path];
}

// a new note task's content: a copy of the template note in settings (".md" may be left off); an empty note when there is none or it's missing
async function templateText(app: App, path: string): Promise<string> {
  const file = path ? app.vault.getAbstractFileByPath(normalizePath(path).replace(/(\.md)?$/i, ".md")) : null;
  return file instanceof TFile ? app.vault.read(file) : "---\n---\n";
}

// a new status: the id comes from the label, numbered to stay unique, and the colour is the first palette colour not yet used (settings and legend alike)
export function newStatus(statuses: StatusDef[], label: string): StatusDef {
  const base = label.trim().toLowerCase().replace(/\s+/g, "-") || "status";
  let id = base;
  for (let i = 2; statuses.some((x) => x.id === id); i++) id = `${base}-${i}`;
  const used = new Set(statuses.map((x) => x.color.toLowerCase()));
  return { id, label: label.trim(), color: PALETTE.find((c) => !used.has(c)) ?? PALETTE[0], group: "active" };
}

export interface KanbanLane {
  title: string;
  cards: { text: string; done: boolean; line: number }[]; // line: the card's line in the note (0-based)
}

// a kanban's current or next card and the lane (stage) it sits in. A lane named like a status (label or id) is read by that status (boards
// this plugin creates have one lane per status): the first unchecked card in the "started" status's lane is now. Next is the first
// unchecked card in board order outside completed, deferred and cancelled lanes (lanes that aren't statuses, such as one per phase, are
// read in order as they are). Cards' blockers and dates aren't read
export function kanbanStep(lanes: KanbanLane[], statuses: StatusDef[], startedId?: string): { card?: string; stage?: string; now?: boolean } {
  const statusOf = (title: string) => statuses.find((s) => [s.label, s.id].some((x) => x.trim().toLowerCase() === title.trim().toLowerCase()));
  const first = (pick: (l: KanbanLane) => boolean) => {
    for (const l of lanes.filter(pick)) {
      const c = l.cards.find((x) => !x.done);
      if (c) return { card: cardLabel(c.text), stage: l.title };
    }
    return undefined;
  };
  const now = startedId ? first((l) => statusOf(l.title)?.id === startedId) : undefined;
  if (now) return { ...now, now: true };
  return first((l) => (statusOf(l.title)?.group ?? "active") === "active") ?? {};
}

// card text without the Kanban markup: [[a|b]] → b, [[a]] → a, and @{date} @@{time} @[[date]] dropped
export function cardLabel(text: string): string {
  return text.replace(DONE_ON, "").replace(/@{1,2}(\{[^}]*\}|\[\[[^\]]*\]\])/g, "").replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2").replace(/\s+/g, " ").trim();
}

// the day a card was done: "✅ date" as the Tasks plugin writes it (Kanban does so on a check when Tasks is enabled; the panel's check writes the same)
const DONE_ON = /\s*✅\s*(\d{4}-\d{2}-\d{2})/;
export function cardDoneOn(text: string): string | undefined {
  return DONE_ON.exec(text)?.[1];
}

// a card starting with its task's name loses it ("DB Adapter — x" → "x")
export function withoutName(card: string, name: string): string {
  const tail = card.slice(name.length);
  return (card.toLowerCase().startsWith(name.toLowerCase()) && /^[\s:—–-]/.test(tail) && tail.replace(/^[\s:—–-]+/, "")) || card;
}

// the share of checked cards in %; 100% only when all are done and 0% only when none are (199/200 doesn't round up to 100%)
export function cardProgress(done: number, total: number): number {
  if (done === total) return 100;
  return Math.min(99, Math.max(done ? 1 : 0, Math.round((100 * done) / total)));
}

// a kanban's lanes and cards, by the Kanban plugin's rule: each ## heading is a lane and the top-level list items under it are cards (with or
// without a checkbox). Everything from the thematic break (***) on is the archive and doesn't count. Progress and the detail panel both use
// this, so their numbers always agree. Pass the note's full text to get the card text too
export function kanbanLanes(cache: CachedMetadata | null, text = ""): KanbanLane[] {
  const heads = (cache?.headings ?? []).filter((h) => h.level === 2);
  if (!heads.length) return [];
  const first = heads[0].position.start.line;
  const end = cache?.sections?.find((x) => x.type === "thematicBreak" && x.position.start.line > first)?.position.start.line ?? Infinity;
  const lanes = heads.filter((h) => h.position.start.line < end).map((h) => ({ line: h.position.start.line, title: h.heading.trim(), cards: [] as KanbanLane["cards"] }));
  for (const li of cache?.listItems ?? []) {
    const line = li.position.start.line;
    if (li.parent >= 0 || line <= first || line >= end) continue;
    const raw = text.slice(li.position.start.offset, li.position.end.offset).split("\n")[0];
    lanes.filter((l) => l.line < line).pop()?.cards.push({ text: raw.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[.\]\s+)?/, "").trim(), done: li.task !== undefined && li.task !== " ", line });
  }
  return lanes.map(({ title, cards }) => ({ title, cards }));
}

// the note's text with one card checked or unchecked; null when that line no longer holds the same card (the board changed after it was read).
// A card without a checkbox gets one. A check adds nothing; an uncheck removes any "✅ date" (as the Tasks plugin, or 2.17.0 to 2.17.2, wrote it)
export function setCardDone(text: string, line: number, card: string, done: boolean): string | null {
  const lines = text.split("\n");
  const m = /^(\s*(?:[-*+]|\d+[.)])\s+)(?:\[.\]\s+)?([^\n]*?)(\r?)$/.exec(lines[line] ?? "");
  if (!m || m[2].trim() !== card) return null;
  lines[line] = `${m[1]}[${done ? "x" : " "}] ${done ? m[2] : m[2].replace(new RegExp(DONE_ON.source, "g"), "")}${m[3]}`;
  return lines.join("\n");
}

// the day this computer first saw each step ticked: compared with the ticked steps it saw before, newly ticked ones get `today` (a board seen for
// the first time only sets the baseline). Unticking drops the date; a step gone from view (archived, deleted) keeps it until older than `keepFrom`
// shortcut: cards with the same label share one date; key by line or block id if boards ever hold duplicate steps
export type StepsSeen = { done: string[]; on: Record<string, string> };
export function seeSteps(prev: StepsSeen | undefined, cards: { text: string; done: boolean }[], today: string, keepFrom: string): StepsSeen {
  const done = cards.filter((c) => c.done).map((c) => cardLabel(c.text));
  if (!prev) return { done, on: {} };
  const open = new Set(cards.filter((c) => !c.done).map((c) => cardLabel(c.text)));
  const was = new Set(prev.done);
  const on: Record<string, string> = {};
  for (const [card, day] of Object.entries(prev.on)) if (day >= keepFrom && !open.has(card)) on[card] = day;
  for (const card of done) if (!was.has(card)) on[card] ??= today;
  return { done, on };
}

// rename the task file (updates links)
// "taken" when a note of that name already sits in the folder (no overwrite, no exception)
export async function renameTask(app: App, path: string, newName: string): Promise<string | null | "taken"> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return null;
  // drop characters a file name can't hold, and #^[]| which break links
  // control characters and invisible direction marks too (pasted in, they keep typed links from resolving); Windows' reserved names are refused
  const safe = newName.replace(/[\\/:*?"<>|#^[\]\u0000-\u001f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "").trim();
  if (!safe || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(safe)) return null;
  const dir = file.parent && file.parent.path !== "/" ? file.parent.path + "/" : "";
  const newPath = `${dir}${safe}.md`;
  if (newPath === path) return path;
  // a case-only rename goes through; otherwise ask the file system (Windows ignores case)
  if (newPath.toLowerCase() !== path.toLowerCase() && (await app.vault.adapter.exists(newPath))) return "taken";
  await app.fileManager.renameFile(file, newPath);
  return newPath;
}

// delete a task to the user's trash (recoverable)
export async function deleteTask(app: App, path: string): Promise<boolean> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return false;
  await app.fileManager.trashFile(file);
  return true;
}

// every tag present in the vault (without #, most-used first), for input suggestions;
// built with the public getAllTags rather than the undocumented metadataCache.getTags()
export function collectAllTags(app: App): string[] {
  const count = new Map<string, number>();
  for (const file of app.vault.getMarkdownFiles()) {
    const cache = app.metadataCache.getFileCache(file);
    if (!cache) continue;
    for (const raw of getAllTags(cache) ?? []) {
      const tag = raw.replace(/^#/, "");
      if (tag) count.set(tag, (count.get(tag) ?? 0) + 1);
    }
  }
  // most-used first, ties broken by name
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag]) => tag);
}

// add a tag to frontmatter `tags` (deduped)
export async function addTag(app: App, path: string, tag: string): Promise<boolean> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return false;
  const clean = tag.replace(/^#/, "").trim();
  if (!clean) return false;
  let changed = false;
  await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
    const cur = normalizeTags(fm.tags);
    if (!cur.some((x) => x.toLowerCase() === clean.toLowerCase())) {
      cur.push(clean);
      fm.tags = cur;
      changed = true;
    }
  });
  return changed;
}

// remove a tag from frontmatter `tags` (inline #tags are not touched)
export async function removeTag(app: App, path: string, tag: string): Promise<void> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return;
  const clean = tag.replace(/^#/, "").trim();
  await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
    const cur = normalizeTags(fm.tags).filter((x) => x.toLowerCase() !== clean.toLowerCase());
    if (cur.length) fm.tags = cur;
    else delete fm.tags;
  });
}

// paths of a task's subtree (self + descendants)
export function subtreePaths(tasks: Task[], rootPath: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (p: string) => {
    if (seen.has(p)) return;
    seen.add(p);
    out.push(p);
    for (const c of tasks) if (c.parent === p) visit(c.path);
  };
  visit(rootPath);
  return out;
}

// set/clear a task's parent and move its whole subtree into destFolder (the D&D core)
// returns the moves made (from → to, for undo)
export async function reparentTask(
  app: App,
  settings: GanttSettings,
  tasks: Task[],
  srcPath: string,
  destFolder: string,
  parentFile: TFile | null
): Promise<{ moves: { from: string; to: string }[] } | null> {
  const src = app.vault.getAbstractFileByPath(srcPath);
  if (!(src instanceof TFile)) return null;
  const k = settings.keys;
  // set (or clear) the parent link
  await app.fileManager.processFrontMatter(src, (fm: Record<string, unknown>) => {
    if (parentFile) fm[k.parent] = app.fileManager.generateMarkdownLink(parentFile, srcPath);
    else delete fm[k.parent];
  });
  // the subtree co-locates in one folder, so move all of it into destFolder
  const dir = normalizePath(destFolder || "/");
  const prefix = dir === "/" ? "" : dir + "/";
  const moves: { from: string; to: string }[] = [];
  for (const p of subtreePaths(tasks, srcPath)) {
    const f = app.vault.getAbstractFileByPath(p);
    if (!(f instanceof TFile)) continue;
    if (normalizePath(f.parent?.path ?? "/") === dir) continue; // already there
    let name = f.basename;
    let i = 1;
    while (await app.vault.adapter.exists(`${prefix}${name}.md`)) name = `${f.basename} ${++i}`; // Windows ignores case
    const np = `${prefix}${name}.md`;
    await app.fileManager.renameFile(f, np); // Obsidian updates links
    moves.push({ from: p, to: np });
  }
  return { moves };
}

// add a typed dependency; replaces any existing dependency to the same predecessor
export async function addDependency(
  app: App,
  settings: GanttSettings,
  successorPath: string,
  predPath: string,
  type: DepType
): Promise<boolean> {
  if (successorPath === predPath) return false;
  const succ = app.vault.getAbstractFileByPath(successorPath);
  const pred = app.vault.getAbstractFileByPath(predPath);
  if (!(succ instanceof TFile) || !(pred instanceof TFile)) return false;
  const k = settings.keys;
  await app.fileManager.processFrontMatter(succ, (fm: Record<string, unknown>) => {
    // an unquoted [[x]] is read as a wikilink string too (fmList)
    const arr = fmList(fm[k.after]);
    // drop any existing entry to the same predecessor
    const kept = arr.filter(
      (raw) => resolveLink(app, stripDepType(raw), successorPath)?.path !== predPath
    );
    const link = app.fileManager.generateMarkdownLink(pred, successorPath);
    kept.push(type === "FS" ? link : `${type}:${link}`); // FS has no prefix, for backward compatibility
    fm[k.after] = kept;
  });
  return true;
}

// remove a dependency
export async function removeDependency(
  app: App,
  settings: GanttSettings,
  successorPath: string,
  predPath: string
): Promise<void> {
  const succ = app.vault.getAbstractFileByPath(successorPath);
  if (!(succ instanceof TFile)) return;
  const k = settings.keys;
  await app.fileManager.processFrontMatter(succ, (fm: Record<string, unknown>) => {
    if (fm[k.after] == null) return;
    const list = fmList(fm[k.after]);
    const filtered = list.filter(
      (raw) => resolveLink(app, stripDepType(raw), successorPath)?.path !== predPath
    );
    if (filtered.length) fm[k.after] = filtered;
    else delete fm[k.after];
  });
}
