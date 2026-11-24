import { setIcon } from "obsidian";
// table column definitions: label, width, sorting, painting and inline editing in one place
import type { BoardContext } from "./board";
import type { GanttSettings } from "./settings";
import type { Row, Task, CustomField, CustomValue, StatusDef } from "./types";
import {
  anchorStart,
  anchorEnd,
  writeField,
  writeStatus,
  validCustomFields,
  customValueText,
  parseCustomInput,
} from "./model";
import { formatDate, dayIndex, dayToStr, todayIndex } from "./timeline";
import { autoStatusTargets, endForDuration, parseDuration, scheduleOptions, taskDuration, workdaysBetween } from "./schedule";
import { linkLabel } from "./links";
import { besideHeading } from "./filter";
import { handleLinkClick, renderLinkValue } from "./linkui";
import { openPopover } from "./popover";
import { t as tr } from "./i18n"; // aliased to avoid clashing with the `t` task var

// a sort key (numbers subtract, anything else compares as text)
export type SortKey = string | number;

interface ColumnBase {
  id: string;
  label: () => string; // header label (follows the UI language)
  width: number; // default width; user overrides live in settings.columnWidths
  optional: boolean; // toggleable from the gear menu
  sortKey: (t: Task, settings: GanttSettings) => SortKey;
}

// the task-name column: the view draws it itself (indent, collapse, context menu). Renaming lives in the
// detail panel's title and a click opens the panel — the one exception to "every column is inline-editable"
export interface NameColumn extends ColumnBase {
  kind: "name";
}

// a regular column. Every column the table can show is inline-editable (a standing rule), so `edit` is required
export interface CellColumn extends ColumnBase {
  kind: "cell";
  // paint the cell; returning false marks it read-only (no editor attached)
  paint: (ctx: BoardContext, td: HTMLElement, row: Row) => boolean | void;
  // the editor opened by a double-click
  edit: (ctx: BoardContext, cell: HTMLElement, row: Row) => void;
  editAria: () => string; // aria label of an editable cell
}

export type ColumnDef = NameColumn | CellColumn;

const NO_DATE = "9999-99-99"; // undated tasks sort last

// ----- built-in columns -----
export const BUILTIN_COLUMNS: ColumnDef[] = [
  {
    kind: "name",
    id: "name",
    label: () => tr().colTask,
    width: 240, // the table is the main reading surface: name, exception tag and subtask summary share it
    optional: false,
    sortKey: (t) => t.name.toLowerCase(),
  },
  {
    kind: "cell",
    id: "start",
    label: () => tr().colStart,
    width: 96, // fits a glance date ("Wed 25 Nov")
    optional: true,
    sortKey: (t) => anchorStart(t) ?? NO_DATE,
    paint: (ctx, td, row) => {
      td.empty();
      const t = row.task!;
      const fmt = ctx.settings.dateFormat;
      // a rolled-up parent shows the aggregated span (read-only)
      const rolled = ctx.rollup && row.span ? row.span : null;
      if (rolled) {
        td.setText(formatDate(rolled.start, fmt));
        return false;
      }
      if (t.milestone) {
        // diamond marker; no start to edit
        td.setText("◆");
        td.addClass("ogantt-td-ms");
        return false;
      }
      // append the time of day when set; wrap in a span (a bare text node can't ellipsis inside a flex cell)
      td.createSpan({ cls: "ogantt-td-text", text: formatDate(t.start, fmt) + (t.startTime ? ` ${t.startTime}` : "") });
    },
    edit: (ctx, cell, row) => openCellDatePicker(ctx, cell, row.task!, "start"),
    editAria: () => tr().pickDate,
  },
  {
    kind: "cell",
    id: "end",
    label: () => tr().colDue,
    width: 96,
    optional: true,
    sortKey: (t) => anchorEnd(t) ?? NO_DATE,
    paint: (ctx, td, row) => {
      td.empty();
      const t = row.task!;
      const fmt = ctx.settings.dateFormat;
      const rolled = ctx.rollup && row.span ? row.span : null;
      if (rolled) {
        td.setText(formatDate(rolled.end, fmt));
        return false;
      }
      td.createSpan({ cls: "ogantt-td-text", text: formatDate(t.end, fmt) + (t.endTime ? ` ${t.endTime}` : "") });
    },
    edit: (ctx, cell, row) => openCellDatePicker(ctx, cell, row.task!, "end"),
    editAria: () => tr().pickDate,
  },
  {
    kind: "cell",
    id: "duration",
    label: () => tr().colDuration,
    width: 64,
    optional: true,
    // unset (no dates) sorts ahead of zero
    sortKey: (t, s) => taskDuration(t, scheduleOptions(s).cal) ?? -1,
    paint: (ctx, td, row) => {
      td.empty();
      td.addClass("ogantt-td-number");
      const cal = scheduleOptions(ctx.settings).cal;
      // a rolled-up parent shows its span's duration (read-only)
      const rolled = ctx.rollup && row.span ? row.span : null;
      if (rolled) {
        td.setText(tr().durationDays(workdaysBetween(dayIndex(rolled.start), dayIndex(rolled.end), cal)));
        return false;
      }
      const t = row.task!;
      // a milestone has no duration (a single due date)
      if (t.milestone) return false;
      paintDuration(ctx, td, t);
    },
    edit: (ctx, cell, row) => {
      const t = row.task!;
      const cal = scheduleOptions(ctx.settings).cal;
      const cur = taskDuration(t, cal);
      ctx.inlineInput(
        cell,
        cur != null ? String(cur) : "",
        () => paintDuration(ctx, cell, t),
        async (raw) => {
          const n = parseDuration(raw);
          if (n == null || n === cur) {
            paintDuration(ctx, cell, t); // only a whole number ≥ 1 is written
            return;
          }
          // keep the start and move the due date (from today when unset)
          const start = t.start ?? dayToStr(todayIndex(undefined, ctx.settings.tz));
          const end = dayToStr(endForDuration(dayIndex(start), n, cal));
          await ctx.reschedule(t.path, { start, end }, { start: t.startTime, end: t.endTime });
        },
        (inp) => {
          inp.type = "number";
          inp.min = "1";
          inp.step = "1";
        }
      );
    },
    editAria: () => tr().editDuration,
  },
  {
    kind: "cell",
    id: "progress",
    label: () => tr().fieldProgress,
    width: 84,
    optional: true,
    sortKey: (t) => t.progress ?? -1, // unset sorts ahead of 0%
    // progress always shows/edits the task's own value, even when rolled up (there's no weight to aggregate by);
    // a kanban with cards works it out from its checked cards, so it isn't edited here (hover for the count)
    paint: (_ctx, td, row) => {
      const t = row.task!;
      paintProgress(td, t);
      if (!t.cards) return;
      td.setAttr("aria-label", tr().kanbanProgress(t.cards.done, t.cards.total));
      return false;
    },
    edit: (ctx, cell, row) => {
      const t = row.task!;
      ctx.inlineInput(
        cell,
        t.progress != null ? String(t.progress) : "",
        () => paintProgress(cell, t),
        (v) => commitProgress(ctx, t, v),
        (inp) => {
          inp.type = "number";
          inp.min = "0";
          inp.max = "100";
          inp.step = "5";
        }
      );
    },
    editAria: () => tr().editProgress,
  },
  {
    kind: "cell",
    id: "assignee",
    label: () => tr().fieldAssignee,
    width: 96,
    optional: true,
    sortKey: (t) => t.assignees.map(linkLabel).join(",").toLowerCase(),
    paint: (ctx, td, row) => paintAssignee(ctx, td, row.task!, besideHeading(row.task!.assignees, "assignees", ctx.groupBy, row.group)),
    // multi-valued like tags, so it opens chips + an add field
    edit: (ctx, cell, row) => openListEditor(ctx, cell, row.task!, "assignees"),
    editAria: () => tr().editAssignee,
  },
  {
    kind: "cell",
    id: "status",
    label: () => tr().fieldStatus,
    width: 96,
    optional: true,
    // status sorts by the configured order, not alphabetically
    sortKey: (t, s) => {
      if (t.status == null) return 999;
      const i = s.statuses.findIndex((x) => x.id === t.status);
      return i < 0 ? 999 : i;
    },
    paint: (ctx, td, row) => paintStatus(ctx, td, row.task!),
    edit: (ctx, cell, row) => editStatus(ctx, cell, row.task!),
    editAria: () => tr().editStatus,
  },
  {
    kind: "cell",
    id: "tags",
    label: () => tr().fieldTags,
    width: 140,
    optional: true,
    sortKey: (t) => t.tags.join(",").toLowerCase(),
    paint: (ctx, td, row) => paintTags(ctx, td, besideHeading(row.task!.tags, "tags", ctx.groupBy, row.group)),
    // tags are multi-valued, so the cell opens the panel's chips + add field in a popover
    edit: (ctx, cell, row) => openListEditor(ctx, cell, row.task!, "tags"),
    editAria: () => tr().editTags,
  },
];

// ----- custom field columns -----

// the column id of a custom field
export function customColumnId(f: CustomField): string {
  return `cf:${f.id}`;
}

// turn one custom field into a column (after the built-ins, in definition order)
export function customColumn(f: CustomField): CellColumn {
  const name = (): string => f.label.trim() || f.key.trim();
  return {
    kind: "cell",
    id: customColumnId(f),
    label: name,
    width: f.type === "text" ? 120 : 96,
    optional: true,
    // text: case-insensitive, unset first; number: unset first; date: unset last (like start / due)
    sortKey: (t) => {
      const v = t.custom[f.id];
      if (f.type === "number") return typeof v === "number" ? v : -Number.MAX_VALUE; // -Infinity - -Infinity is NaN
      if (f.type === "date") return typeof v === "string" ? v : NO_DATE;
      return customValueText(v).toLowerCase();
    },
    paint: (ctx, td, row) => {
      td.empty();
      const v = row.task!.custom[f.id];
      if (v == null) return;
      const text = f.type === "date" && typeof v === "string" ? formatDate(v, ctx.settings.dateFormat) : customValueText(v);
      td.createSpan({ cls: "ogantt-td-text", text });
      if (f.type === "number") td.addClass("ogantt-td-number");
    },
    edit: (ctx, cell, row) => {
      const t = row.task!;
      const v = t.custom[f.id];
      // write, then reload (undoable)
      const write = async (next: CustomValue | undefined): Promise<void> => {
        await ctx.mutate(tr().undoEdit(t.name), [t.path], () => writeField(ctx.app, t.path, f.key.trim(), next));
        await ctx.refresh();
      };
      if (f.type === "date") {
        const d = typeof v === "string" ? v : "";
        const state = { start: d, end: d };
        ctx.openRangePicker(cell, state, "start", () => {}, () => (state.start === d ? undefined : write(state.start || undefined)), name());
        return;
      }
      const repaint = (): void => {
        cell.empty();
        const text = customValueText(v);
        if (text) cell.createSpan({ cls: "ogantt-td-text", text });
      };
      ctx.inlineInput(
        cell,
        customValueText(v),
        repaint,
        async (raw) => {
          const next = parseCustomInput(raw, f.type, Array.isArray(v));
          if (next === null) {
            repaint(); // a non-number isn't written
            return;
          }
          await write(next);
        },
        f.type === "number" ? (inp) => { inp.type = "number"; } : undefined
      );
    },
    editAria: () => tr().editCustomField(name()),
  };
}

// every column definition (built-ins, then usable custom fields); shared by the view and the settings tab
export function allColumns(settings: GanttSettings): ColumnDef[] {
  return [...BUILTIN_COLUMNS, ...validCustomFields(settings).map(customColumn)];
}

// ----- order, visibility and comparison (pure) -----

// the column order: name first, optional columns as saved; columns missing from it (older saved data, a new custom field)
// follow in definition order, and unknown ids are ignored
export function orderedColumns(defs: ColumnDef[], order: string[]): ColumnDef[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  const at = (c: ColumnDef): number => (c.optional ? rank.get(c.id) ?? order.length + defs.indexOf(c) : -1);
  return defs.slice().sort((a, b) => at(a) - at(b));
}

// visible columns: name always, the rest when listed in visibleColumns, in the saved order
export function visibleColumns(defs: ColumnDef[], visible: string[], order: string[] = []): ColumnDef[] {
  const vis = new Set(visible);
  return orderedColumns(defs, order).filter((c) => !c.optional || vis.has(c.id));
}

// the column list (Display menu and settings): shown optional columns in order, then the hidden ones, which can still be reordered, re-shown and resized
export function columnList(defs: ColumnDef[], visible: string[], order: string[]): { col: ColumnDef; on: boolean }[] {
  const vis = new Set(visible);
  const opt = orderedColumns(defs, order).filter((c) => c.optional);
  return [...opt.filter((c) => vis.has(c.id)), ...opt.filter((c) => !vis.has(c.id))].map((col) => ({ col, on: vis.has(col.id) }));
}

// show or hide a column; the order is saved as the list shows it (a hidden column goes to the top of the hidden ones, a re-shown one to the end of the shown)
// returned under the settings' own keys, ready for Object.assign
export function toggleColumn(defs: ColumnDef[], visible: string[], order: string[], id: string, on: boolean): { visibleColumns: string[]; columnOrder: string[] } {
  const list = columnList(defs, visible, order);
  const vis = new Set(visible);
  if (on) vis.add(id);
  else vis.delete(id);
  return {
    visibleColumns: keepUnknown(list.filter((x) => vis.has(x.col.id)).map((x) => x.col.id), visible, defs),
    columnOrder: keepUnknown(list.map((x) => x.col.id), order, defs),
  };
}

// keep column ids the current definitions don't know (say, a custom field whose key is being retyped) at their old place; dropping them would lose their visibility and position
function keepUnknown(next: string[], prev: string[], defs: ColumnDef[]): string[] {
  const known = new Set(defs.map((c) => c.id));
  const out = [...next];
  prev.forEach((id, i) => {
    if (!known.has(id) && !out.includes(id)) out.splice(Math.min(i, out.length), 0, id);
  });
  return out;
}

// move a column one up (dir = -1) or down (+1) in the list, never across the shown/hidden boundary (null when it can't move)
export function moveColumn(defs: ColumnDef[], visible: string[], order: string[], id: string, dir: -1 | 1): string[] | null {
  const list = columnList(defs, visible, order);
  const i = list.findIndex((x) => x.col.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length || list[j].on !== list[i].on) return null;
  [list[i], list[j]] = [list[j], list[i]];
  return keepUnknown(list.map((x) => x.col.id), order, defs);
}

// effective column width (user override > default)
export function columnWidth(def: ColumnDef, overrides: Record<string, number>): number {
  return overrides[def.id] ?? def.width;
}

// the manual order (by path); tasks not in it go after, in the fallback's order
export function manualComparator(order: string[], fallback: (a: Task, b: Task) => number): (a: Task, b: Task) => number {
  const at = new Map(order.map((p, i) => [p, i]));
  return (a, b) => (at.get(a.path) ?? order.length) - (at.get(b.path) ?? order.length) || fallback(a, b);
}

// disabled tasks go last (siblings are compared, so last within their parent or group)
export function disabledLast(off: Set<string>, compare: (a: Task, b: Task) => number): (a: Task, b: Task) => number {
  return (a, b) => Number(off.has(a.path)) - Number(off.has(b.path)) || compare(a, b);
}

// build a task comparator; an unknown column id sorts by start
export function taskComparator(defs: ColumnDef[], settings: GanttSettings): (a: Task, b: Task) => number {
  const def = defs.find((c) => c.id === settings.sortBy) ?? defs.find((c) => c.id === "start")!;
  const dir = settings.sortDir === "desc" ? -1 : 1;
  // keep each task's key for the sort (not rebuilt on every comparison)
  const keys = new Map<Task, ReturnType<ColumnDef["sortKey"]>>();
  const key = (t: Task) => {
    if (!keys.has(t)) keys.set(t, def.sortKey(t, settings));
    return keys.get(t)!;
  };
  return (a, b) => {
    const ka = key(a);
    const kb = key(b);
    const c = typeof ka === "number" && typeof kb === "number" ? ka - kb : String(ka).localeCompare(String(kb));
    return c * dir;
  };
}

// ----- cell painting and editing -----

// open the range calendar from a table cell
function openCellDatePicker(ctx: BoardContext, anchor: HTMLElement, t: Task, which: "start" | "end"): void {
  const state = { start: t.start ?? "", end: t.end ?? "" };
  const save = async (): Promise<void> => {
    // "start only" isn't valid: fill end = start
    if (state.start && !state.end) state.end = state.start;
    // keep the existing time of day across the date change (clamp if inverted on the same day)
    const ts = t.startTime;
    let te = t.endTime;
    if (state.start && state.start === state.end && ts && te && te < ts) te = ts;
    await ctx.reschedule(t.path, state, { start: ts, end: te });
  };
  // no chip repaint needed here
  ctx.openRangePicker(anchor, state, which, () => {}, save);
}

// duration cell in workdays; blank when the dates aren't set
function paintDuration(ctx: BoardContext, td: HTMLElement, t: Task): void {
  td.empty();
  const d = taskDuration(t, scheduleOptions(ctx.settings).cal);
  if (d != null) td.createSpan({ cls: "ogantt-td-text", text: tr().durationDays(d) });
}

// paint a progress cell (thin meter + %); unset still draws an empty meter and a dash,
// so the cell reads as double-click editable whether or not it has a value
// the progress to show (a whole number 0–100; unset or not a number is null), the same in the table, the panel and the hover card
export function progressPct(t: Task): number | null {
  return t.progress != null && Number.isFinite(t.progress) ? Math.max(0, Math.min(100, Math.round(t.progress))) : null;
}

export function paintProgress(td: HTMLElement, t: Task): void {
  td.empty();
  td.addClass("ogantt-td-progress");
  // a kanban shows only how many cards are checked (not effort, nor being on schedule); a cell without a value stays empty (no rows of "—" and empty meters)
  if (t.cards) return void td.createSpan({ cls: "ogantt-meter-num ogantt-cards", text: tr().cardsShort(t.cards.done, t.cards.total) });
  const p = progressPct(t);
  td.toggleClass("is-empty", p == null);
  if (p == null) return;
  const track = td.createDiv({ cls: "ogantt-meter" });
  track.createDiv({ cls: "ogantt-meter-fill" }).style.width = `${p}%`;
  td.createSpan({ cls: "ogantt-meter-num", text: `${p}%` });
}

// save progress; 0% and blank clear the field (same rule as the panel slider)
async function commitProgress(ctx: BoardContext, t: Task, raw: string): Promise<void> {
  const n = raw === "" ? 0 : Math.max(0, Math.min(100, Math.round(Number(raw) || 0)));
  const next = n > 0 ? n : undefined;
  if (next === t.progress) return;
  await ctx.mutate(tr().undoEdit(t.name), [t.path], () => writeField(ctx.app, t.path, ctx.settings.keys.progress, next));
  await ctx.refresh();
}

// assignee cell: avatars + names (a wikilink opens its note on click). When grouped by assignee,
// the heading's person isn't repeated: only the others show, after a "+"
function paintAssignee(ctx: BoardContext, td: HTMLElement, t: Task, people: string[]): void {
  td.empty();
  td.addClass("ogantt-td-people");
  for (const a of people) ctx.avatar(td, a);
  const names = td.createSpan({ cls: "ogantt-td-text" });
  if (people.length < t.assignees.length && people.length) names.appendText("+ ");
  people.forEach((a, i) => {
    if (i) names.appendText(", ");
    renderLinkValue(names, a, "").addEventListener("click", (e) => handleLinkClick(ctx.app, e, t.path));
  });
}

// a status mark: a shape on top of the colour (readable in greyscale): started = filled dot, other Active = ring, Deferred = square,
// Completed = check, Cancelled = cross
// a status's kind, the one grammar shared by the table's marks and the timeline's bars (a task without a status is waiting)
export function statusKind(s: StatusDef | undefined, startedId: string | undefined): "done" | "cancelled" | "blocked" | "running" | "queued" {
  return s?.group === "completed" ? "done" : s?.group === "cancelled" ? "cancelled" : s?.group === "deferred" ? "blocked" : s && s.id === startedId ? "running" : "queued";
}

export function statusMark(host: HTMLElement, s: StatusDef, startedId: string | undefined): HTMLElement {
  const kind = statusKind(s, startedId);
  const mark = host.createSpan({ cls: `ogantt-status-dot is-${kind}`, attr: { "aria-hidden": "true" } });
  mark.style.setProperty("--ogantt-status", s.color);
  if (kind === "done" || kind === "cancelled") setIcon(mark, kind === "done" ? "check" : "x");
  return mark;
}

// status cell (shape-and-colour mark + label)
function paintStatus(ctx: BoardContext, td: HTMLElement, t: Task): void {
  td.empty();
  const s = ctx.settings.statuses.find((x) => x.id === t.status);
  if (!s) return;
  statusMark(td, s, autoStatusTargets(ctx.settings.statuses, ctx.settings.autoStatus).started);
  td.createSpan({ cls: "ogantt-td-text", text: s.label });
}

// status has a fixed set, so it edits as a select
function editStatus(ctx: BoardContext, cell: HTMLElement, t: Task): void {
  if (cell.querySelector("input, select")) return;
  cell.empty();
  const sel = cell.createEl("select", { cls: "ogantt-cell-input", attr: { "aria-label": tr().fieldStatus } });
  sel.createEl("option", { text: "—", value: "" }); // clear the status
  // keep a status the list doesn't know selected, so closing the editor doesn't erase it
  if (t.status && !ctx.settings.statuses.some((s) => s.id === t.status)) sel.createEl("option", { text: t.status, value: t.status }).selected = true;
  for (const s of ctx.settings.statuses) {
    const o = sel.createEl("option", { text: s.label, value: s.id });
    if (s.id === t.status) o.selected = true;
  }
  sel.focus();
  // open the dropdown right away; where showPicker is unavailable, focus is enough and a click opens it
  try {
    sel.showPicker();
  } catch {
    /* already focused, nothing to do */
  }
  let settled = false;
  const finish = (save: boolean): void => {
    if (settled) return;
    settled = true;
    sel.dataset.done = "1"; // a finished edit doesn't hold the board's reload
    if (!save || sel.value === (t.status ?? "")) {
      paintStatus(ctx, cell, t);
      return;
    }
    void (async () => {
      await ctx.mutate(tr().undoEdit(t.name), [t.path], () =>
        writeStatus(ctx.app, t.path, ctx.settings, sel.value || undefined, dayToStr(todayIndex(undefined, ctx.settings.tz)))
      );
      await ctx.refresh();
    })();
  };
  sel.addEventListener("change", () => finish(true));
  sel.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); finish(false); } });
  sel.addEventListener("blur", () => finish(true));
}

// tags cell (multi-valued chips)
function paintTags(ctx: BoardContext, td: HTMLElement, tags: string[]): void {
  td.empty();
  td.addClass("ogantt-td-tags");
  for (const tag of tags) {
    const chip = td.createSpan({ cls: "ogantt-tag-chip", text: tag });
    ctx.paintTagChip(chip, tag);
    // right-click a tag chip to change its color
    chip.addEventListener("contextmenu", (e) => ctx.openTagMenu(e, tag));
  }
}

// the editor popover of a multi-valued column (tags, assignees): a cell can't hold several values, so it opens the panel's chips + add field
function openListEditor(ctx: BoardContext, anchor: HTMLElement, t: Task, field: "tags" | "assignees"): void {
  openPopover(anchor, "ogantt-tagmenu", (menu) => {
    const build = (): void => {
      menu.empty();
      ctx.chipList(menu, t.path, field, build).focus(); // stay in the field to add more
    };
    build();
  });
}
