// types shared between the view and its parts (column defs, etc.)
import type { App } from "obsidian";
import type { GanttSettings } from "./settings";
import type { GroupBy } from "./filter";

// a file move or rename
export type Move = { from: string; to: string };

// what mutate's fn returns: false = nothing changed (not recorded); true / void = changed
// a change to the status field alone (automatic status; undo puts back only this field)
export type StatusChange = { path: string; from?: string; to: string };

// an op that returns `statuses` is undone field by field, not as whole files
export type MutateResult = { moves?: Move[]; created?: string[]; deleted?: string[]; statuses?: StatusChange[] } | boolean | void;

// the narrow surface parts use instead of the whole GanttView; the view implements it
export interface BoardContext {
  readonly app: App;
  readonly settings: GanttSettings;
  readonly rollup: boolean; // whether parents are drawn as the span of their descendants
  readonly groupBy: GroupBy; // the grouping axis (rows don't repeat their heading's value)
  // every write goes through here (makes it undoable)
  mutate(label: string, paths: string[], fn: () => Promise<MutateResult>): Promise<boolean>;
  // write start & due and cascade to successors (undoable); a start-only change keeps
  // the duration by moving the due date too. Returns the due date actually written
  reschedule(path: string, next: { start: string; end: string }, times?: { start?: string; end?: string }): Promise<string>;
  refresh(): Promise<void>; // reload from disk and re-render

  // ----- UI helpers for in-cell editing -----
  // swap a cell for an input (Enter/blur saves, Esc cancels, an unchanged value is never written)
  inlineInput(
    cell: HTMLElement,
    value: string,
    repaint: () => void,
    commit: (v: string) => Promise<void>,
    configure?: (inp: HTMLInputElement) => void
  ): void;
  // the range calendar
  openRangePicker(
    anchor: HTMLElement,
    state: { start: string; end: string },
    active: "start" | "end",
    repaint: () => void,
    save: () => void | Promise<void>,
    single?: string // single-date mode (the field name shown)
  ): void;
  // chips + an add field for tags or assignees (multi-valued); calls `changed` after an edit and returns the field
  chipList(host: HTMLElement, path: string, field: "tags" | "assignees", changed: () => void): HTMLInputElement;
  // colour a tag chip
  paintTagChip(chip: HTMLElement, tag: string): void;
  // a tag's right-click menu (colour)
  openTagMenu(e: MouseEvent, tag: string): void;
  // an assignee avatar (initials in a circle)
  avatar(parent: HTMLElement, who: string): void;
}
