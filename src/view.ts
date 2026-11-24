import { CachedMetadata, Component, ItemView, Keymap, Menu, MarkdownRenderer, PaneType, Platform, Scope, WorkspaceLeaf, normalizePath, setIcon, Notice, TFile, TFolder, ViewStateResult, moment } from "obsidian";
import type GanttPlugin from "./main";
import { ME_KEY } from "./settings";
import { Task, TaskKind, Row, ZoomMode, DepType, GanttViewState, Layout, VIEW_TYPE_GANTT, Filter, FilterMatch, FilterPreset, DateFilterItem, CategoryFilter, CategoryField, CategoryOp, TextFilter, TextOp, DateValue, DateOp, DateField, DateUnit, DateDir, StatusDef, StatusGroup, STATUS_GROUPS } from "./types";
import {
  collectTasks,
  collectFolders,
  movePaths,
  buildRows,
  createTask,
  reparentTask,
  subtreePaths,
  validCustomFields,
  writeDates,
  combineDateTime,
  writeField,
  editListField,
  writeBody,
  renameTask,
  deleteTask,
  addTag,
  removeTag,
  collectAllTags,
  addDependency,
  removeDependency,
  readBody,
  bodyOf,
  kanbanLanes,
  kanbanStep,
  cardLabel,
  setCardDone,
  cardDoneOn,
  seeSteps,
  type StepsSeen,
  applyStatus,
  writeStatus,
  withoutName,
  removeLinkTo,
  KanbanLane,
  newStatus,
  anchorStart,
  anchorEnd,
  statusGroupOf,
} from "./model";
import { autoStatusChanges, autoStatusTargets, renameAutoStatusId, cascadeDates, depViolated, endForDuration, isWorkday, keepDurationOnStartChange, offDayGradient, parseDuration, prevWorkday, scheduleOptions, successorClosure, taskDuration, weekStart, workdaysBetween, wouldLoop } from "./schedule";
import {
  DateRange,
  computeRange,
  dayIndex,
  dayToStr,
  pxPerDay,
  buildTicks,
  buildBands,
  todayIndex,
  formatDate,
  growPad,
  nearEdge,
  padRange,
  padToCover,
  RangePad,
  revealSpan,
  buildProgressLine,
  ProgressLineRow,
  Tick,
} from "./timeline";
import { distinctColors, hashColor, inkOn, resolveTagColor } from "./colors";
import { closePopovers, openPopover, paletteInto, pickColor, pickIcon } from "./popover";
import { ConfirmModal, PickModal, ChoiceModal, ReportModal, Health, HEALTH_CALLOUT, HEALTH_LABEL } from "./modals";
import { linkLabel } from "./links";
import { attachLinkSuggest, handleLinkClick, renderLinkValue, wireLinkHover } from "./linkui";
import { t as tr, statusGroupLabel } from "./i18n"; // aliased to avoid clashing with the `t` task var
import { schedulePush } from "./gcal/sync";
import { isConnected } from "./gcal/auth";
import { ATTENTION, EXCEPTIONS, applyFilters, tagSpelling, besideHeading, exceptionsOf, interruptions, isOpen, isOverdue, isUrgent, nextToStart, openCounts, regroup, runningWorkOf, subtaskSummary, urgentFirst, Exception, GroupBy, Interruptions } from "./filter";
import { BoardContext, Move, MutateResult, StatusChange } from "./board";
import { CellColumn, ColumnDef, allColumns, columnList, columnWidth, disabledLast, manualComparator, moveColumn, paintProgress, progressPct, statusKind, statusMark, taskComparator, toggleColumn, visibleColumns } from "./columns";
import { boardColumns, boardWhen, byPerson, isSprint, reportSections } from "./lanes";
import type { AiBoard, Edit } from "./ai";
import { buildWorkPlan, planPeriods, PlanPeriod } from "./workplan";

const ROW_H = 30; // shared row height
// a key pressed while an input method is composing (Enter confirms the conversion and Esc cancels it; neither is meant for us)
const composing = (e: KeyboardEvent): boolean => e.isComposing || e.keyCode === 229;
const HEAD_H = 40; // header height
const BAR_PAD = 5; // vertical padding inside a row
const RESIZE_EDGE = 8; // edge-resize hit width
const MIN_PPD = 2; // minimum px/day in Fit mode
const FIT_SCROLLBAR_PAD = 16; // room for the vertical scrollbar
const REVEAL_PAD = 24; // room kept between a revealed bar and the edge
const FALLBACK_BAR = "#7c8db5"; // bar color when status/assignee is unset

const MAX_INDENT_DEPTH = 8; // visual indent cap (the tree itself is unlimited)
const MAX_AVATARS = 3; // avatars beside a bar (the label names everyone)
const MAX_PILLS = 3; // tag pills after a label (the rest become +N)
// the font sizes of bar labels and tag pills, used both as their font-size and when measuring widths to place the pills
const LABEL_PX = 11;
const PILL_PX = 9.5;
const KEY_PX = 11; // the exported colour key's text size, for laying it out and drawing it alike
// the exported image's text: a system font that also exists inside an SVG image
const EXPORT_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
// from the bar end to the label: past the turn of a dependency arrow (12px) and the end handle (11px)
const LABEL_GAP = 18;
// rows drawn beyond the viewport, so small scrolls don't repaint
const WINDOW_PAD = 25;
// operations touching more files than this show a "working" notice
const BUSY_FILES = 10;
// how many days the board treats as "now": finished work due earlier, or open work starting later, is folded away (two weeks, Jira's Kanban default)
const FOLD_DAYS = 14;

// task-kind icons (plain notes get none)
const KIND_ICON: Record<TaskKind, string> = { note: "file-text", kanban: "square-kanban", canvas: "layout-dashboard" };
// the icon and word of each exception tag
const EXC_ICON: Record<Exception, string> = { urgent: "zap", overdue: "alarm-clock", blocked: "circle-slash", dependency: "unlink", interrupted: "pause", resume: "play" };
const EXC_TEXT: Record<Exception, () => string> = { urgent: () => tr().excUrgent, overdue: () => tr().excOverdue, blocked: () => tr().attBlocked, dependency: () => tr().excDependency, interrupted: () => tr().excInterrupted, resume: () => tr().excResume };
// isolate a name or card text from what surrounds it (FSI … PDI), so Hebrew and other right-to-left text doesn't reorder the sentence
const isolate = (text: string): string => `\u2068${text}\u2069`;
type CardStep = { card?: string; stage?: string; now?: boolean };
// a ticked step and its day (its ✅ date, or the day this computer first saw the tick)
type CardDone = { card: string; on: string };
// remembers that "Which one is you?" was closed (this device only)
const ASKED_KEY = "task-gantt-me-asked";
// the days this computer first saw steps ticked (this device only; nothing goes into the notes)
const STEPS_KEY = "task-gantt-steps-seen";

// initials of a name for an avatar (up to two letters)
function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => [...w][0]).join("").toUpperCase();
}

// one history entry: pre-op path → contents (null = didn't exist) and the op's moves, in order
// created / deleted decide which paths a restore may re-create (no other missing file is ever re-created)
interface HistoryEntry {
  label: string;
  files: Map<string, string | null>;
  // what the files should hold when this is undone (redone); anything else was changed outside, so it isn't overwritten (ops with moves aren't checked)
  expect?: Map<string, string | null>;
  moves: Move[];
  created: string[]; // made by the op
  statuses?: StatusChange[]; // automatic status changes (undo touches only this field)
  disable?: { paths: string[]; on: boolean }; // tasks disabled or enabled (board setting only)
  deleted: string[]; // removed by the op
}

// whether move b is move a itself, or follows from a folder move a
function movesUnder(a: Move, b: Move): boolean {
  if (a.from === b.from && a.to === b.to) return true;
  return b.from.startsWith(a.from + "/") && b.to === a.to + b.from.slice(a.from.length);
}

// the two connector handles, shared by every bar (none with arrows hidden, or in an export)
interface Handles {
  show(t: Task, g: SVGGElement, lx: number, rx: number, cy: number): void;
  hide(): void;
}

// a date format in the UI language (UTC); some moment locale names ("x-pseudo", …) are unknown to Intl, which then gets the default language
// a date's weekday in the UI language ("Fri")
const weekdayOf = (iso: string): string => dateFormat({ weekday: "short" }).format(new Date(`${iso}T00:00:00Z`));

function dateFormat(o: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(moment.locale(), { ...o, timeZone: "UTC" });
  } catch {
    return new Intl.DateTimeFormat(undefined, { ...o, timeZone: "UTC" });
  }
}

// shows the × that removes a dependency at (x, y) over its arrow (null hides it)
type DepX = (dep: DepRow | null, x?: number, y?: number) => void;

// one dependency to draw, with the rows of both ends
interface DepRow {
  t: Task;
  pred: Task;
  type: DepType;
  si: number;
  pi: number;
}

export class GanttView extends ItemView {
  plugin: GanttPlugin;
  private zoom: ZoomMode;
  private tasks: Task[] = [];
  private rows: Row[] = [];
  private range: DateRange = { min: 0, max: 0 }; // the shown range (the tasks' range plus the pad)
  private baseRange: DateRange = { min: 0, max: 0 }; // the tasks' range
  // the endless timeline: days added before and after by scrolling (reset by a zoom or board change), and whether a grow is under way
  private pad: RangePad = { before: 0, after: 0 };
  private extending = false;
  private ppd = 16;
  private selectedPath: string | null = null;
  private folder = ""; // scoped folder path
  private layout: Layout = "timeline"; // how this tab shows the board (remembered per tab)
  private layoutSeg: HTMLElement | null = null; // the toolbar's layout switch
  // the filters (per tab, so a filter tried in another tab never changes the board shown at the daily scrum)
  private filters: Filter[] = [];
  private filterMatch: FilterMatch = "all";
  private olderOpen = new Set<string>(); // columns also showing their older finished cards (board)
  private history = false; // the Timeline also shows finished work from before the window
  private teamOpen = new Set<string>(); // people whose card shows everything (team)
  private collapsed = new Set<string>(); // collapsed folder keys
  private order: string[] = []; // the manual row order (task paths; used while the sort is "manual")
  private disabled = new Set<string>(); // disabled tasks (greyed, last among their siblings)
  private expanded = new Set<string>(); // expanded parent tasks (paths); parents start collapsed

  // view options (remembered per board in settings.boards)
  private colorBy: "status" | "assignee" = "status";
  private groupBy: GroupBy = "folder";
  private showEmptyFolders = true; // show empty folders as rows (default on)
  private flat = false; // flat list ignoring folders & nesting
  private rollup = false; // draw parent bars as a rollup of descendants (default off)
  private progressLine = false; // progress line against today (default off)
  private showDeps = true; // dependency arrows (and the handles that make links)
  private showTags = true; // tags after the bars' labels
  private allFolders: string[][] = []; // all folders under scope
  private filterHost!: HTMLElement; // unified filter bar container

  // undo & redo history (snapshots of affected files + moves)
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  // >0 while we are writing, so only outside renames remap the history
  private historyBusy = 0;
  // outside renames arriving together, recorded as a batch
  private pendingRenames: Move[] = [];
  private static readonly UNDO_LIMIT = 50;

  // whether a bar was dragged (to suppress the trailing click)
  private dragged = new WeakMap<SVGGElement, boolean>();

  // debounce timer to re-fit in Fit mode, and the width it fitted
  private fitTimer: number | null = null;
  private fitWidth = 0;

  private boardKey: string | null = null; // the board (folder) whose view options are loaded
  private cursor = 0; // the row the keyboard is on
  private boardMain: HTMLElement | null = null; // the scrolling board body
  private paintWindow: ((force?: boolean) => void) | null = null; // draws the rows in view
  private dragPath: string | null = null; // the task whose row is being dragged
  private tagCache: string[] | null = null; // the vault's tags, gathered when an add field first gets focus
  private card: { el: HTMLElement | null; timer: number | null; x: number; y: number } = { el: null, timer: null, x: 0, y: 0 }; // the bar hover card
  private saveTimer: number | null = null; // a pending settings save
  private filterTimer: number | null = null; // waits for typing in the name filter to pause
  private detailSeq = 0; // detail panel build generation (stale async builds stop)
  private bodyOwner: Component | null = null; // owns the rendered body (embeds, Dataview, …)
  // the board's scroll position (remembered while visible: a hidden tab reads 0 for every scroll value), and where to return once a hidden redraw becomes visible
  private scrollMemo: { top: number; day: number } | null = null;
  private pendingScroll: { top: number; day: number } | null = null;
  private panelSig: string | null = null; // what the detail panel currently shows (no rebuild while it's unchanged)
  private fieldStart = new WeakMap<HTMLElement, string>(); // a panel field's value when it was entered (Esc puts it back)
  private askWhy: string | null = null; // a task just blocked: its panel opens with the cursor in the blocker field
  private undoToast: Notice | null = null; // the notice with an Undo button (closed once the history moves)

  // in-cell editor counter (keeps datalist ids unique)
  private cellEditSeq = 0;

  // DOM refs
  private tbodyEl!: HTMLElement;
  private gridHost!: HTMLElement;
  private detailEl!: HTMLElement;
  private titleText: HTMLElement | null = null;
  private legendHost!: HTMLElement; // the colour key row
  private measureCtx = createEl("canvas").getContext("2d")!; // measures text without a DOM layout
  private tagColorCache = new Map<string, string>(); // tag colours (the default reads CSS, so once per redraw)
  private assigneeCache: string[] | null = null; // the board's assignees, built once per redraw
  private peopleColors: Map<string, string> | null = null; // the assignees' automatic colours (likewise)
  private projectColors: Map<string, string> | null = null; // the folders' automatic colours (likewise)
  private late: Set<string> | null = null; // with arrows hidden, successors whose dependency is broken
  private roomsWatched = false;
  private stale = false; // a reload was skipped while the tab was hidden
  private lastSig = ""; // the signature of the data last drawn
  private readOnlySeen = ""; // the read-only tasks last seen (to tell when a role changed)
  private conflicts = new Set<string>(); // successors whose dependency is broken (for the table's tag, arrows or not)
  private ints: Interruptions = { interrupted: new Map(), resume: new Map() }; // interruptions and work waiting to be resumed
  private shown = new Set<string>(); // tasks that have a row (per redraw)
  private kids = new Map<string, Task[]>(); // parent path → its subtasks (per redraw)
  private linked = new Map<string, { mine: boolean; names: string[] }>(); // others' tasks linked to my work (per card redraw)
  private projects = false; // the cards span two or more folders under the board (cards name their project)
  private cardFocus: string | null = null; // the line of the card just ticked (focus goes back to it after the redraw)
  private cardsOpen = false; // whether the panel's card list is open (a tick's redraw keeps it open)
  // each kanban's current or next card and lane, kept per file mtime so only changed boards are read again
  private cardSteps = new Map<string, { mtime: number; meta: CachedMetadata | null; started?: string; step: CardStep; done: CardDone[] }>();
  private exporting = false; // a PNG export is running
  private historyRunning = false; // an undo or redo is running
  private dragging: "bar" | "link" | "column" | null = null; // what is being dragged (redraws wait)
  private fontFamily = ""; // the bars' font, for measuring
  // a per-view prefix for the SVG pattern and gradient ids: ids are document-wide, and a hidden board in another tab would otherwise shadow ours
  private uid = Math.random().toString(36).slice(2, 8);
  private bare = false; // while drawing an export: no ✓ or ⚠ after the bars (the ✓ is in the name column)
  private undoBtn: HTMLButtonElement | null = null;
  private redoBtn: HTMLButtonElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: GanttPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.zoom = plugin.settings.defaultZoom;
  }

  getViewType(): string {
    return VIEW_TYPE_GANTT;
  }
  getDisplayText(): string {
    const name = this.folder ? this.folder.split("/").pop() : tr().vaultRoot;
    return `${this.layout === "board" ? tr().layoutBoard : this.layout === "team" ? tr().layoutPeople : tr().layoutTimeline}: ${name}`;
  }
  getIcon(): string {
    return "gantt-chart";
  }

  // persist the scoped folder and the layout as the tab's state
  getState(): Record<string, unknown> {
    return { folder: this.folder, layout: this.layout, filters: this.filters, filterMatch: this.filterMatch } satisfies GanttViewState;
  }
  async setState(state: GanttViewState, result: ViewStateResult): Promise<void> {
    // "Projects/" and "/Projects" are one board; the root is ""
    if (state && typeof state.folder === "string") this.folder = normalizePath(state.folder) === "/" ? "" : normalizePath(state.folder);
    if (state?.layout === "timeline" || state?.layout === "board" || state?.layout === "team") {
      if (state.layout !== this.layout) this.lastSig = ""; // a new layout is drawn even when the data is the same
      this.useLayout(state.layout);
    }
    // a state without filters is a tab from before: it takes the old (global) filters
    const legacy = this.plugin.settings;
    this.filters = structuredClone(Array.isArray(state?.filters) ? state.filters : legacy.filters ?? []);
    this.filterMatch = state?.filterMatch === "any" ? "any" : state?.filters ? "all" : legacy.filterMatch ?? "all";
    await super.setState(state, result);
    if (this.gridHost) await this.refresh();
  }

  // rewrite the view header and the toolbar's folder name (the header keeps the name from before the folder was known; titleEl isn't in the typings)
  private retitle(): void {
    (this as unknown as { titleEl?: HTMLElement }).titleEl?.setText(this.getDisplayText());
    this.titleText?.setText(this.folder || tr().vaultRoot);
    // the accessible name starts with the visible one (label-in-name)
    this.titleText?.parentElement?.setAttr("aria-label", `${this.folder || tr().vaultRoot} — ${tr().menuOpen}`);
    (this.leaf as unknown as { updateHeader?: () => void }).updateHeader?.(); // the tab's name too (not in the typings)
  }

  // apply a layout: the switch's pressed button, the class hiding Timeline-only controls, the tab's name
  private useLayout(l: Layout): void {
    this.layout = l;
    this.contentEl.toggleClass("is-cards", l !== "timeline");
    this.layoutSeg?.querySelectorAll<HTMLElement>("button").forEach((b) => {
      b.toggleClass("is-active", b.dataset.layout === l);
      b.setAttr("aria-pressed", String(b.dataset.layout === l));
    });
    this.retitle();
  }

  // switch the layout from the toolbar (no disk read); saved as the tab's state
  private switchLayout(l: Layout): void {
    if (l === this.layout) return;
    this.useLayout(l);
    this.app.workspace.requestSaveLayout();
    this.rerender();
    if (l === "timeline") this.scrollToToday(); // back from the cards, at today
  }

  // the other tabs showing this folder
  private siblings(): GanttView[] {
    return this.app.workspace.getLeavesOfType(VIEW_TYPE_GANTT).map((l) => l.view)
      .filter((v): v is GanttView => v instanceof GanttView && v !== this && v.folder === this.folder);
  }

  async onOpen(): Promise<void> {
    this.buildSkeleton();
    this.showPlaceholder();
    // keys while this view is in front: they come before Obsidian's global ones (F2 = rename file, …); an open modal or menu still goes first
    this.scope = new Scope(this.app.scope);
    this.scope.register([], "Escape", (e) => this.onEscape(e));
    this.scope.register([], "F2", () => this.onF2());
    // the folder arrives through setState right after onOpen, so the first render is left to it (done here only if it never comes)
    window.setTimeout(() => { if (this.boardKey === null) void this.refresh(); }, 0);
    // redraw only for changes under this board's folder
    const inScope = (path: string) => !this.folder || path === this.folder || path.startsWith(this.folder + "/");
    this.registerEvent(this.app.metadataCache.on("changed", (file) => { if (inScope(file.path)) this.scheduleRefresh(); }));
    // redraw once when startup indexing finishes, so a half-indexed board doesn't stick
    let indexed = false;
    this.registerEvent(this.app.metadataCache.on("resolved", () => {
      if (indexed) return;
      indexed = true;
      this.scheduleRefresh();
    }));
    this.registerEvent(this.app.vault.on("create", (file) => { if (inScope(file.path)) this.scheduleRefresh(); }));
    // redraw after a theme or font change (tag pills are placed from text widths)
    this.registerEvent(this.app.workspace.on("css-change", () => { if (this.boardMain) this.rerender(); }));
    this.registerEvent(this.app.vault.on("delete", (file) => { if (inScope(file.path)) this.scheduleRefresh(); }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (this.historyBusy === 0 && !this.isOwnMove(oldPath, file.path)) this.queueOutsideRename(oldPath, file.path);
      // follow the shown folder (or a parent of it) when it's renamed or moved; main.ts has already re-keyed its view options
      if (this.folder && (oldPath === this.folder || this.folder.startsWith(oldPath + "/"))) {
        this.folder = this.boardKey = file.path + this.folder.slice(oldPath.length);
        this.retitle();
        this.app.workspace.requestSaveLayout();
      }
      // the open panel follows the rename too (so text being typed isn't written to the old path and lost)
      if (this.selectedPath) this.selectedPath = movePaths([this.selectedPath], oldPath, file.path)[0];
      // the manual order, disabled tasks and opened parents (keyed by path)
      const order = movePaths(this.order, oldPath, file.path);
      const disabled = movePaths([...this.disabled], oldPath, file.path);
      const expanded = movePaths([...this.expanded], oldPath, file.path);
      if (order.some((k, i) => k !== this.order[i]) || disabled.some((k) => !this.disabled.has(k)) || expanded.some((k) => !this.expanded.has(k))) {
        this.order = order;
        this.disabled = new Set(disabled);
        this.expanded = new Set(expanded);
        this.saveBoard();
      }
      if (inScope(oldPath) || inScope(file.path)) this.scheduleRefresh();
    }));
    // Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y redo. Like Esc and F2 they're view keys, so they work in a pop-out window too.
    // Only while typing text does the native undo win (time-like inputs still let the gantt undo through)
    const history = (redo: boolean) => (e: KeyboardEvent): boolean => {
      const ae = activeDocument.activeElement as HTMLElement | null;
      const editingText =
        !!ae &&
        (ae.tagName === "TEXTAREA" ||
          ae.isContentEditable ||
          (ae.instanceOf(HTMLInputElement) && ["text", "search", "url", "tel", "password", "email", "number"].includes(ae.type)));
      if (editingText) return true;
      e.preventDefault();
      void (redo ? this.redo() : this.undo());
      return false;
    };
    this.scope.register(["Mod"], "z", history(false));
    this.scope.register(["Mod", "Shift"], "z", history(true));
    this.scope.register(["Mod"], "y", history(true));
    // reload when the day changes while open (today line, date filters, automatic status)
    let day = this.today();
    this.registerInterval(window.setInterval(() => {
      if (this.today() === day) return;
      day = this.today();
      void this.refresh();
      this.plugin.requestAutoStatus();
    }, 60_000));
  }

  // persistent toolbar + detail; only the grid re-renders. The detail panel docks beside the board instead of covering it (closed by × or Esc)
  private buildSkeleton(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("ogantt-board");
    // a click anywhere in the board keeps focus in it (on bars and blank space too): in a pop-out
    // window the view's keys (undo and the rest) only arrive while focus is inside the view
    root.setAttr("tabindex", "-1");
    // the toolbar spans the whole view (above the detail panel too): opening the panel never re-wraps it, so the board doesn't jump
    this.renderToolbar(root); // the view options sit on its right
    const body = root.createDiv({ cls: "ogantt-body" });
    const pane = body.createDiv({ cls: "ogantt-pane" });
    this.legendHost = pane.createDiv({ cls: "ogantt-legend" }); // the colour key
    this.filterHost = pane.createDiv({ cls: "ogantt-filterbar" }); // the filter row
    this.gridHost = pane.createDiv({ cls: "ogantt-host" });
    this.detailEl = body.createDiv({ cls: "ogantt-detail", attr: { tabindex: "-1" } }); // takes focus when Esc leaves a field
    this.detailEl.addEventListener("focusin", (e) => {
      const el = e.target as HTMLElement;
      if (el.instanceOf(HTMLInputElement)) this.fieldStart.set(el, el.value);
    });
    // when the pane resizes (window, sidebars, the detail panel opening or closing) draw any newly visible rows, and re-fit in Fit (not for the panel)
    const ro = new (this.contentEl.win as Window & typeof globalThis).ResizeObserver(() => { // the view's own window's (popouts too)
      // a redraw done while the tab was hidden gets its scroll position now that it shows
      if (this.pendingScroll && this.boardMain?.clientHeight) this.applyScroll(this.boardMain, this.pendingScroll);
      this.paintWindow?.();
      // the reload skipped while hidden happens now
      // that the tab shows (after the position is restored: the reload keeps it)
      if (this.stale && this.contentEl.isShown()) return void this.refresh();
      // no re-fit before the first render (with no tasks yet it would show "empty")
      if (this.zoom !== "Fit" || this.boardKey === null || this.fitBase() === this.fitWidth) return;
      if (this.fitTimer != null) window.clearTimeout(this.fitTimer);
      this.fitTimer = window.setTimeout(() => this.rerender(), 80);
    });
    ro.observe(this.gridHost);
    this.register(() => ro.disconnect());
    // a touch long-press acts as a right-click (row and heading menus); moving the finger cancels it
    let press: { timer: number; x: number; y: number } | null = null;
    const cancel = () => {
      if (press) window.clearTimeout(press.timer);
      press = null;
    };
    this.gridHost.addEventListener("pointerdown", (e) => {
      cancel(); // a second finger cancels the first press
      const target = e.target as HTMLElement;
      if (e.pointerType !== "touch" || !e.isPrimary || target.closest("input, textarea, select")) return;
      const timer = window.setTimeout(() => {
        press = null;
        target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY }));
      }, 500);
      press = { timer, x: e.clientX, y: e.clientY };
    });
    this.gridHost.addEventListener("pointermove", (e) => {
      if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) cancel();
    });
    for (const ev of ["pointerup", "pointercancel", "contextmenu"]) this.gridHost.addEventListener(ev, cancel);
  }

  // Esc: an open popover or cell editor closes itself; in a panel field the first Esc leaves the field, the next closes the panel and returns to the row
  private onEscape(e: KeyboardEvent): boolean {
    const el = activeDocument.activeElement as HTMLElement | null;
    if (composing(e) || e.defaultPrevented || !this.detailEl.hasClass("is-open") || activeDocument.querySelector(".ogantt-popover, .ogantt-link-suggest") || el?.closest(".ogantt-tr :is(input, select)")) return true;
    if (el?.closest(".ogantt-detail") && el.matches("input, textarea, select")) {
      // cancel the typing before leaving the field, so leaving doesn't save it (the body editor saves on leaving by design, so it's left as is)
      if (el.instanceOf(HTMLInputElement)) el.value = this.fieldStart.get(el) ?? el.value;
      this.detailEl.focus();
    } else this.closeDetail(true);
    return false;
  }

  // F2 renames the keyboard's row in place
  private onF2(): boolean {
    const el = activeDocument.activeElement as HTMLElement | null;
    const row = el?.matches(".ogantt-tr") ? this.rows[Number(el.dataset.index)] : undefined;
    const name = el?.querySelector<HTMLElement>(".ogantt-name-text");
    if (row?.kind !== "task" || !name) return true;
    this.renameInCell(name, row.task!, el!);
    return false;
  }

  // placeholder rows until the first render
  private showPlaceholder(): void {
    this.gridHost.empty();
    const sk = this.gridHost.createDiv({ cls: "ogantt-skeleton", attr: { "aria-busy": "true" } });
    for (let i = 0; i < 8; i++) sk.createDiv({ cls: "ogantt-skeleton-row" });
  }

  private refreshTimer: number | null = null;
  private scheduleRefresh(): void {
    if (this.refreshTimer != null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => void this.refresh(), 300);
  }

  // stop the pending timer on close
  async onClose(): Promise<void> {
    // a pending filter edit or save is written now rather than dropped
    const pending = this.saveTimer != null || this.filterTimer != null;
    for (const timer of [this.refreshTimer, this.fitTimer, this.saveTimer, this.filterTimer, this.card.timer]) if (timer != null) window.clearTimeout(timer);
    this.refreshTimer = this.fitTimer = this.saveTimer = this.filterTimer = this.card.timer = null;
    this.card.el?.remove();
    closePopovers(this.contentEl.ownerDocument); // close any popover left open in this view's window
    if (pending) await this.plugin.saveData(this.plugin.settings);
  }

  // a signature of the data a render reads: tasks, folders, card steps, settings (minus the records that change by themselves), today and
  // this device's name; equal means no rebuild is needed
  private dataSig(): string {
    const look = { ...this.plugin.settings, gcal: 0, notify: 0 };
    return JSON.stringify([this.tasks, this.allFolders, [...this.cardSteps].map(([p, s]) => [p, s.step, s.done]), look, this.today(), this.me()]);
  }

  // re-collect from disk, then render
  async refresh(): Promise<void> {
    if (!this.gridHost) this.buildSkeleton();
    // during startup (mid-indexing) keep the placeholder and draw once ready
    if (!this.app.workspace.layoutReady) {
      this.app.workspace.onLayoutReady(() => this.scheduleRefresh());
      return;
    }
    // a hidden tab doesn't reload: it notes it's stale and reloads once shown (from the ResizeObserver), so open tabs don't all repeat the work
    if (this.boardKey !== null && !this.contentEl.isShown()) return void (this.stale = true);
    this.stale = false;
    // wait while a write, an undo or a drag is under way (it would swap the tasks they update, or remove the bar being dragged)
    // also while a table cell is being typed in (a rebuild would drop the text or save it half-typed)
    const typing = this.tbodyEl?.contains(activeDocument.activeElement) && activeDocument.activeElement!.matches("input:not([data-done]), select:not([data-done]), textarea");
    if (this.historyBusy > 0 || this.dragging || typing) return this.scheduleRefresh();
    // switching to another board loads its view options; the scroll position and the selection don't carry over
    const opened = this.boardKey !== this.folder;
    if (opened) {
      this.boardKey = this.folder;
      this.loadBoard();
      this.closeDetail(); // first: closing redraws, so the old board's view is forgotten after it
      this.pad = { before: 0, after: 0 };
      this.boardMain = null;
      this.cursor = 0;
      this.retitle();
      // a fresh history too (the old one would rewrite files that aren't on screen)
      this.undoStack = [];
      this.redoStack = [];
      this.updateUndoButton();
    }
    this.tasks = collectTasks(this.app, this.plugin.settings, this.folder);
    await this.readCardSteps();
    this.allFolders = collectFolders(this.app, this.plugin.settings, this.folder);
    // nothing a render reads changed (typing in a body, the reload after the panel's own edit): no rebuild. The panel update below still runs
    const sig = this.dataSig();
    if (opened || sig !== this.lastSig) {
      this.lastSig = sig;
      this.rerender();
    }
    // automatic status is requested when a board opens (not on every reload)
    if (opened) this.plugin.requestAutoStatus();
    // bring an open detail panel up to date: rebuilt only when what it shows changed (not for another note's change, nor the reload after the
    // panel's own edit), and left alone while a field is being edited. Closed when its task is gone
    const path = this.selectedPath;
    if (!path || !this.detailEl.hasClass("is-open")) return;
    const ae = activeDocument.activeElement;
    // while a field is being typed in, neither close nor redraw (never drop what's being typed)
    if (ae && ae !== this.detailEl && this.detailEl.contains(ae) && ae.matches("input:not([type=checkbox]), textarea, select")) {
      // when the note is gone, look again once the field is left (and close then)
      if (!this.tasks.some((x) => x.path === path)) ae.addEventListener("blur", () => void this.refresh(), { once: true });
      return; // a checkbox has already saved
    }
    const t = this.tasks.find((x) => x.path === path);
    if (!t) return this.closeDetail();
    // (once the field is left, the line above closes it)
    if (this.panelSig !== this.sigOf(t, await readBody(this.app, path))) await this.openDetail(path);
  }

  // one automatic-status run (tasks = everything under the default folder; called one at a time from main.ts). Everything is one undoable action,
  // announced with a count and an Undo button, and its undo puts back only the status field (later edits to the body etc. stay). Returns the notes
  // written with their new status and records the rules that fired (main.ts saves); a note that couldn't be written stays out of both
  async applyAutoStatus(tasks: Task[]): Promise<Map<string, string>> {
    const s = this.plugin.settings;
    const wrote = new Map<string, string>();
    const was = new Map(tasks.map((t) => [t.path, t.status]));
    // notes already right are only remembered as seen, so a later hand edit can be told apart
    const changes = [...autoStatusChanges(tasks, s.statuses, s.autoStatus, this.today())].filter(([p, c]) => {
      if (this.readOnly(p)) return false; // never written automatically either (it would just be put back)
      if (c.status !== was.get(p)) return true;
      this.plugin.settings.autoStatus.fired[p] = { dates: c.dates, status: c.status };
      return false;
    });
    if (!changes.length) return wrote;
    const statuses: StatusChange[] = [];
    await this.mutate(tr().autoStatusLabel, [], async () => {
      // record only after every write settles, so one failure can't skew the record
      // write only notes still holding the status that was read (a hand edit meanwhile is left alone)
      const res = await Promise.allSettled(changes.map(([p, c]) => this.swapStatus(p, was.get(p), c.status)));
      changes.forEach(([p, c], i) => {
        const r = res[i];
        if (r.status !== "fulfilled" || !r.value) return;
        statuses.push({ path: p, from: was.get(p), to: c.status });
        wrote.set(p, c.status);
        this.plugin.settings.autoStatus.fired[p] = { dates: c.dates, status: c.status }; // into the current settings (even if a sync swapped them)
      });
      if (res.some((r) => r.status === "rejected")) new Notice(tr().writeFailed);
      return statuses.length ? { statuses } : false;
    });
    if (wrote.size) this.undoToast = this.buttonNotice(tr().autoStatusDone(wrote.size), tr().undoShort, () => void this.undo(), 8000);
    return wrote;
  }

  // take the statuses automatic status wrote into the in-memory tasks and redraw, without waiting for the metadata cache
  takeStatuses(statuses: Map<string, string>): void {
    let hit = false;
    for (const t of this.tasks) {
      const st = statuses.get(t.path);
      if (st !== undefined) (t.status = st), (hit = true);
    }
    if (hit) this.rerender();
  }

  // whether a write, an undo or a drag is under way (automatic status waits for every board)
  isBusy(): boolean {
    return this.historyBusy > 0 || this.historyRunning || this.dragging != null;
  }

  // undo or redo an automatic-status run: only the status field goes back (or forward); a note whose status was changed by hand since is left alone
  private async replayStatuses(list: StatusChange[], redo: boolean): Promise<void> {
    await Promise.allSettled(list.map((c) => (redo ? this.swapStatus(c.path, c.from, c.to) : this.swapStatus(c.path, c.to, c.from))));
  }

  // set the status to `next` if it still is `now` (undefined = unset); true when written
  private async swapStatus(path: string, now: string | undefined, next: string | undefined): Promise<boolean> {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) return false;
    const { keys, statuses } = this.plugin.settings;
    const today = dayToStr(this.today());
    let done = false;
    await this.app.fileManager.processFrontMatter(f, (fm: Record<string, unknown>) => {
      if ((fm[keys.status] == null ? undefined : String(fm[keys.status])) !== now) return;
      applyStatus(fm, keys, statuses, next, today);
      done = true;
    });
    return done;
  }

  // a fingerprint of what the detail panel shows (the task's data and its body)
  private sigOf(t: Task, body: string): string {
    return `${JSON.stringify(t)}\u0000${body}\u0000${(this.ints.interrupted.get(t.path) ?? []).map((u) => u.path).join()}|${(this.ints.resume.get(t.path) ?? []).map((u) => u.path).join()}|${this.readOnly(t.path)}`;
  }

  // settings changed on another device: reload this board's own view setup, then redraw (so the old one isn't saved back)
  reloadBoard(): void {
    if (this.boardKey != null) this.loadBoard();
    void this.refresh();
  }

  // load this board's view options (grouping, colour, toggles, collapsed rows)
  private loadBoard(): void {
    const b = this.plugin.settings.boards[`folder:${this.folder}`];
    this.groupBy = b?.groupBy ?? "folder";
    this.colorBy = b?.colorBy ?? "status";
    this.flat = b?.flat ?? false;
    this.rollup = b?.rollup ?? false;
    this.progressLine = b?.progressLine ?? false;
    this.showEmptyFolders = b?.showEmptyFolders ?? true;
    this.showDeps = b?.showDeps ?? true;
    this.showTags = b?.showTags ?? true;
    // collapse keys belong to a grouping axis ("folder:Design", …); an older key without one is a folder key
    this.collapsed = new Set((b?.collapsed ?? []).map((k) => (/^(folder|status|assignee|tag):/.test(k) ? k : `folder:${k}`)));
    this.order = [...(b?.order ?? [])];
    this.disabled = new Set(b?.disabled ?? []);
    this.expanded = new Set(b?.expanded ?? []);
  }

  // remember the view options
  private saveBoard(): void {
    const { groupBy, colorBy, flat, rollup, progressLine, showEmptyFolders, showDeps, showTags } = this;
    // the manual order and disabled tasks are saved without notes that are gone
    const exists = (p: string) => this.app.vault.getAbstractFileByPath(p) instanceof TFile;
    this.order = this.order.filter(exists);
    this.disabled = new Set([...this.disabled].filter(exists));
    this.expanded = new Set([...this.expanded].filter(exists));
    this.plugin.settings.boards[`folder:${this.folder}`] = { groupBy, colorBy, flat, rollup, progressLine, showEmptyFolders, showDeps, showTags, collapsed: [...this.collapsed], order: this.order, disabled: [...this.disabled], expanded: [...this.expanded] };
    this.saveSoon();
    // other tabs of this folder take the same setup (so no stale copy overwrites it)
    for (const v of this.siblings()) {
      v.loadBoard();
      v.rerender();
    }
  }

  // re-key a collapsed heading (a status rename); main.ts re-keys the saved board setups
  renameCollapsed(from: string, to: string): void {
    if (!this.collapsed.has(from) || this.collapsed.has(to)) return;
    this.collapsed.delete(from);
    this.collapsed.add(to);
  }

  // batch settings saves (data.json isn't rewritten on every keystroke or click)
  private saveSoon(): void {
    if (this.saveTimer != null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.plugin.saveData(this.plugin.settings);
    }, 500);
  }

  // render from in-memory tasks (no disk read)
  // shows correct positions before metadataCache updates
  rerender(): void {
    if (!this.gridHost) this.buildSkeleton();
    this.hideCard(); // the bar under it is about to be replaced
    this.assigneeCache = this.peopleColors = this.projectColors = null;
    this.tagColorCache.clear();
    this.renderLegend(); // the legend depends on the data (the assignees)
    this.renderFilterBar(); // refresh the unified filter row
    // interruptions come from every task, filters aside (the sort puts resumable work early too)
    this.ints = interruptions(this.tasks, this.plugin.settings.statuses, this.today());
    this.watchRooms();
    this.readOnlySeen = this.tasks.filter((t) => this.readOnly(t.path)).map((t) => t.path).join("|");
    // each parent's subtasks (filters aside, disabled ones left out), so rows don't scan every task
    this.kids = new Map();
    for (const x of this.tasks) if (x.parent && !this.disabled.has(x.path)) this.kids.set(x.parent, [...(this.kids.get(x.parent) ?? []), x]);
    const view = this.processTasks(); // after filter + group remap
    if (this.layout !== "timeline") return this.renderCards(view);
    const compare = this.comparator();
    if (this.flat) {
      // flat: one sorted list, no grouping/nesting
      this.rows = view.slice().sort(compare).map((task) => ({ kind: "task", group: "", depth: 0, task }));
    } else {
      // seed empty folders only when grouping by folder and the option is on
      const folders = this.showEmptyFolders && this.groupBy === "folder" ? this.allFolders : [];
      // headings close only when collapsed; parent tasks stay closed unless expanded (the summary first, details on demand). Subtasks nest under every grouping
      const axis = `${this.groupBy}:`;
      const shut = new Set([...this.collapsed].filter((k) => k.startsWith(axis) && !k.endsWith(".md")).map((k) => k.slice(axis.length)));
      for (const t of view) if (t.parent && !this.expanded.has(t.parent)) shut.add(t.parent);
      this.rows = buildRows(view, shut, folders, compare, true);
    }
    this.shown = new Set(this.rows.flatMap((r) => (r.task ? [r.task.path] : [])));
    // keep the scroll position across redraws: vertical as is, horizontal by the date in the middle (a zoom change keeps that day centred)
    // a hidden tab reads 0 everywhere, so use the position remembered while visible
    // only a Timeline's box holds a position (a card layout's box reads as 1970)
    const prev = this.boardMain?.hasClass("ogantt-main") ? this.boardMain : null;
    const keep = prev && (prev.clientHeight ? this.scrollOf(prev) : this.pendingScroll ?? this.scrollMemo);
    const hadFocus = !!this.tbodyEl?.contains(activeDocument.activeElement); // keep keyboard focus on the rows
    this.baseRange = computeRange(view, this.today());
    // Fit fits the range to the width, so it never grows; otherwise the pad keeps the day in view before the redraw inside the range
    if (this.zoom === "Fit") this.range = this.baseRange;
    else {
      // only when that day fell outside the range (a zoom change, a task moved); otherwise the pad stays, so redraws can't grow it past the limit
      const shown = padRange(this.baseRange, this.pad);
      if (keep && (keep.day < shown.min || keep.day > shown.max + 1)) this.pad = padToCover(this.baseRange, this.pad, keep.day, this.zoom);
      this.range = padRange(this.baseRange, this.pad);
    }
    this.ppd = this.computePpd();

    // a grow keeps the same scroll box, so a thumb drag or momentum scroll carries on
    // nothing to show: when the filters hide everything say so and offer Clear filters; when the folder is truly empty offer New task
    const filtered = view.length === 0 && this.tasks.length > 0;
    const empty = this.rows.length === 0 || filtered;
    const reuse = this.extending && !empty && prev?.isConnected ? prev : null;
    if (!reuse) this.gridHost.empty();
    this.boardMain = null;
    this.cursor = Math.max(0, Math.min(this.cursor, this.rows.length - 1));
    if (empty) return this.renderEmpty(filtered);
    const main = reuse ?? this.gridHost.createDiv({ cls: "ogantt-main" });
    reuse?.empty();
    this.boardMain = main;
    this.renderGrid(main);
    if (keep) this.applyScroll(main, keep);
    this.paintWindow?.(true);
    // when drawn right at an edge (just opened, say), grow without waiting for a scroll
    if (!this.extending) main.win.requestAnimationFrame(() => this.growNearEdge());
    // keyboard focus stays on the rows after a redraw, without scrolling (on the table body when that row isn't drawn)
    if (hadFocus) (this.tbodyEl.querySelector<HTMLElement>(`.ogantt-tr[data-index="${this.cursor}"]`) ?? this.tbodyEl).focus({ preventScroll: true });
  }

  // how rows sort: by the sorted column, or the manual order while the sort is "manual"; disabled tasks always last among their siblings
  private comparator(): (a: Task, b: Task) => number {
    const s = this.plugin.settings;
    const byColumn = taskComparator(this.columns(), s); // "manual" is no column, so this is by start
    return disabledLast(this.disabled, urgentFirst(s.statuses, s.sortBy === "manual" ? manualComparator(this.order, byColumn) : byColumn, this.ints.resume));
  }

  // move a row one up or down among its siblings (the sort becomes "manual"); true when it moved
  private moveRow(i: number, dir: -1 | 1): boolean {
    const row = this.rows[i];
    if (row?.kind !== "task") return false;
    let j = i + dir;
    while (this.rows[j]?.kind === "task" && this.rows[j].depth > row.depth) j += dir; // skip child rows
    const other = this.rows[j];
    if (other?.kind !== "task" || other.depth !== row.depth) return false;
    this.placeRow(row.task!.path, other.task!.path, dir < 0 ? "before" : "after");
    return true;
  }

  // place `src` before or after `target`; the manual order starts from the order on screen (a column sort included)
  private placeRow(src: string, target: string, where: "before" | "after"): void {
    const order = [...new Set(this.tasks.slice().sort(this.comparator()).map((t) => t.path))].filter((p) => p !== src);
    order.splice(order.indexOf(target) + (where === "after" ? 1 : 0), 0, src);
    this.order = order;
    this.plugin.settings.sortBy = "manual";
    this.saveBoard();
    this.rerender();
    const k = this.rows.findIndex((r) => r.task?.path === src);
    if (k >= 0) this.focusRow(k);
  }

  // disable or enable tasks (undoable; nothing is written to the notes)
  private setDisabled(paths: string[], on: boolean, label?: string): void {
    for (const p of paths) {
      if (on) this.disabled.add(p);
      else this.disabled.delete(p);
    }
    if (label) this.record({ label, files: new Map(), moves: [], created: [], deleted: [], disable: { paths, on } });
    this.saveBoard();
    this.rerender();
  }

  // the scroll position: vertical as is, horizontal as the date in the middle (a zoom change keeps that day centred)
  private scrollOf(main: HTMLElement): { top: number; day: number } {
    return { top: main.scrollTop, day: this.range.min + (main.scrollLeft + (main.clientWidth - this.tableWidth()) / 2) / this.ppd };
  }

  // restore a position; when hidden and it can't be, it's restored once shown (from the ResizeObserver)
  private applyScroll(main: HTMLElement, at: { top: number; day: number }): void {
    if (!main.clientHeight) return void (this.pendingScroll = at);
    this.pendingScroll = null;
    main.scrollTop = at.top;
    main.scrollLeft = this.dayX(at.day) - (main.clientWidth - this.tableWidth()) / 2;
    this.scrollMemo = this.scrollOf(main);
  }

  // the empty state: why it's empty, and what to do next
  private renderEmpty(filtered: boolean): void {
    this.paintWindow = null;
    const box = this.gridHost.createDiv({ cls: "ogantt-empty" });
    box.createDiv({ text: filtered ? tr().noMatches : tr().emptyMessage(this.folder || tr().vaultRoot) });
    const btn = box.createEl("button", { cls: "mod-cta", text: filtered ? tr().presetClear : tr().newTaskName });
    btn.onclick = () => {
      if (!filtered) return void this.createNewTask();
      this.filters = [];
      this.commitFilters();
    };
  }

  // ----- the board and team layouts (tasks as cards) -----

  // draw cards (no rows, no timeline). Sprint notes become the line on top, not cards; a parent with a subtask on show is no card of its own,
  // its name heads its subtasks' cards instead (nothing is counted twice)
  private renderCards(list: Task[]): void {
    const prev = this.boardMain?.hasClass("ogantt-cards") ? this.boardMain : null;
    const keep = prev?.clientHeight ? { top: prev.scrollTop, left: prev.scrollLeft } : null; // a hidden tab reads 0
    this.rows = []; // so row code (export, keyboard) never sees stale rows
    this.paintWindow = null;
    this.conflicts = this.lateTasks();
    this.linked = this.linkedToMe();
    const cards = this.cardsOf(list);
    this.shown = new Set(cards.map((t) => t.path));
    // cards name their project only when the board spans two or more
    this.projects = new Set(cards.map((t) => this.projectOf(t))).size > 1;
    this.gridHost.empty();
    this.boardMain = null;
    // nothing to show: say why and what next (the team, unfiltered, still shows idle people)
    const idle = this.layout === "team" && !this.filters.length && this.tasks.some((t) => t.assignees.length && !isSprint(t));
    if (!cards.length && !idle) return this.renderEmpty(this.tasks.some((t) => !isSprint(t)));
    const main = this.gridHost.createDiv({ cls: "ogantt-cards" });
    this.boardMain = main;
    this.sprintLine(main);
    if (this.layout === "board") this.renderBoard(main, cards);
    else this.renderTeam(main, cards);
    if (keep) (main.scrollTop = keep.top), (main.scrollLeft = keep.left);
  }

  // the board: a column per status (settings order, no cancelled column), cards needing attention on top. Finished columns fold away
  // work due more than two weeks ago, open columns work starting more than two weeks ahead. Dropping a card on another column changes its status
  private renderBoard(main: HTMLElement, list: Task[]): void {
    const { statuses, autoStatus } = this.plugin.settings;
    const kept = statuses.filter((s) => s.group !== "cancelled");
    const live = list.filter((t) => statusGroupOf(statuses, t.status) !== "cancelled");
    // each card's attention rank is worked out once, not on every comparison
    const rank = new Map(live.map((t) => {
      const e = this.exceptionsOf(t).find((x) => x !== "blocked"); // the column says blocked
      return [t, e ? EXCEPTIONS.indexOf(e) : EXCEPTIONS.length] as const;
    }));
    const base = this.comparator();
    const sorted = live.slice().sort((a, b) => rank.get(a)! - rank.get(b)! || base(a, b));
    const ids = boardColumns(sorted, kept);
    const cells = ids.map((id) => sorted.filter((t) => (t.status || null) === id));
    const started = autoStatusTargets(statuses, autoStatus).started;
    // during a sprint the board is that sprint's: finished columns hold what was done since it began, open columns what starts before it ends
    const [from, to] = this.window();
    // shortcut: every card is drawn at once (the Timeline virtualizes its rows); fine for hundreds of tasks, virtualize if boards reach thousands
    const board = main.createDiv({ cls: "ogantt-kb" });
    ids.forEach((id, i) => {
      const s = kept.find((x) => x.id === id);
      const name = s?.label ?? id ?? tr().noStatus; // a status these settings lack (added on another computer) shows its id
      const col = board.createDiv({ cls: "ogantt-kb-col" + (s ? "" : " is-unknown"), attr: { role: "list", "aria-label": name } });
      const head = col.createDiv({ cls: "ogantt-kb-head" });
      if (s) statusMark(head, s, started);
      head.createSpan({ cls: "ogantt-kb-name", text: name, attr: { dir: "auto" } });
      const finished = s?.group === "completed";
      const key = id ?? "";
      const folded = cells[i].filter((t) => boardWhen(t, finished, from, to) !== "now");
      head.createSpan({ cls: "ogantt-kb-count", text: String(cells[i].length - folded.length) }); // what shows (the folded ones are on their button)
      const open = this.olderOpen.has(key);
      for (const t of open ? cells[i] : cells[i].filter((t) => !folded.includes(t))) this.renderCard(col, t, "");
      if (folded.length) {
        col.createEl("button", { cls: "ogantt-kb-more", text: finished ? (open ? tr().hideOlder(folded.length) : tr().olderDone(folded.length)) : open ? tr().hideLater(folded.length) : tr().laterTodo(folded.length) }).onclick = () => {
          if (open) this.olderOpen.delete(key);
          else this.olderOpen.add(key);
          this.rerender();
        };
      }
      // only a known status takes drops (a drop never clears or invents one)
      if (s) this.dropToStatus(col, s);
    });
  }

  // the team: one card per person (a shared task under each); me first, then by name, "(none)" last and only while it holds open work.
  // Unfiltered, an idle person still gets a card saying so. "Now" is started work (any status but the not-started ones, blocked included),
  // "Next" two other open tasks by due date
  private renderTeam(main: HTMLElement, list: Task[]): void {
    const { statuses, autoStatus } = this.plugin.settings;
    const notStarted = autoStatusTargets(statuses, autoStatus).notStarted;
    const none = tr().presetUnassigned;
    const me = this.me();
    const pool = this.filters.length ? list : this.tasks.filter((t) => !isSprint(t));
    const lanes = byPerson(list.slice().sort(this.comparator()), [...new Set(pool.flatMap((t) => t.assignees.map(linkLabel)))], none, me);
    // without this device's name yet, ask for it here (your card then comes first and work linked to yours is marked); closed, it isn't asked again
    if (!me && !this.app.loadLocalStorage(ASKED_KEY)) {
      const ask = main.createDiv({ cls: "ogantt-whoami", attr: { role: "group", "aria-label": tr().whoAreYou } });
      ask.createSpan({ text: tr().whoAreYou });
      for (const [key] of lanes.filter(([k]) => k !== none)) {
        const pick = ask.createEl("button", { cls: "ogantt-whoami-person" });
        this.avatar(pick, this.assigneeList().find((a) => linkLabel(a) === key) ?? key);
        pick.createSpan({ text: key, attr: { dir: "auto" } });
        pick.onclick = () => {
          this.app.saveLocalStorage(ME_KEY, key);
          this.plugin.settingTab?.refreshIfOpen();
          for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_GANTT)) if (leaf.view instanceof GanttView) leaf.view.rerender();
        };
      }
      const close = ask.createEl("button", { cls: "clickable-icon", attr: { "aria-label": tr().close } });
      setIcon(close, "x");
      close.onclick = () => {
        this.app.saveLocalStorage(ASKED_KEY, "1");
        this.rerender();
      };
    }
    const grid = main.createDiv({ cls: "ogantt-team" });
    const since = weekdayOf(dayToStr(this.since()));
    for (const [key, tasks] of lanes) {
      const live = tasks.filter((t) => !this.disabled.has(t.path) && isOpen(t, statuses));
      if (key === none && !live.length) continue;
      const card = grid.createDiv({ cls: "ogantt-pcard", attr: { role: "group", "aria-label": key } });
      const head = card.createDiv({ cls: "ogantt-pcard-head" });
      if (key === none) setIcon(head.createSpan({ cls: "ogantt-pcard-icon", attr: { "aria-hidden": "true" } }), "circle-dashed");
      else this.avatar(head, this.assigneeList().find((a) => linkLabel(a) === key) ?? key);
      head.createSpan({ cls: "ogantt-pcard-name", text: key, attr: { dir: "auto" } });
      const now = live.filter((t) => !!t.status && !notStarted.includes(t.status));
      const due = (t: Task) => anchorEnd(t) ?? "9999";
      const next = live.filter((t) => !now.includes(t)).sort((a, b) => due(a).localeCompare(due(b))).slice(0, 2);
      const all = this.teamOpen.has(key);
      // the "(none)" card has no Now: unassigned work is nobody's current work
      if (now.length || key !== none) card.createDiv({ cls: "ogantt-pcard-label", text: tr().teamNow });
      if (!now.length && key !== none) card.createDiv({ cls: "ogantt-pcard-idle", text: tr().teamIdle });
      for (const t of all ? now : now.slice(0, 3)) this.renderCard(card, t, key);
      if (now.length > 3) {
        card.createEl("button", { cls: "ogantt-kb-more", text: all ? tr().collapse : tr().teamMore(now.length - 3) }).onclick = () => {
          if (all) this.teamOpen.delete(key);
          else this.teamOpen.add(key);
          this.rerender();
        };
      }
      if (next.length) {
        card.createDiv({ cls: "ogantt-pcard-label", text: tr().teamNext });
        for (const t of next) this.renderCard(card, t, key);
      }
      // done since the last daily scrum: tasks and checked cards (a card counts for the people on its task)
      const done = tasks.map((t) => ({ t, d: this.doneSince(t) })).filter(({ d }) => d.on || d.cards.length);
      if (!done.length) continue;
      card.createDiv({ cls: "ogantt-pcard-label", text: tr().doneSince(since) });
      for (const { t, d } of done) {
        const row = card.createDiv({ cls: "ogantt-pcard-done", attr: { tabindex: "0", role: "button", title: this.doneTip(t, d) } });
        setIcon(row.createSpan({ cls: "ogantt-exc-icon", attr: { "aria-hidden": "true" } }), "check-check");
        row.createSpan({ text: t.name, attr: { dir: "auto" } });
        if (!d.on) row.createSpan({ cls: "ogantt-pcard-sep", text: "›", attr: { "aria-hidden": "true" } });
        if (!d.on) row.createSpan({ cls: "ogantt-pcard-steps", text: d.cards.map((c) => withoutName(c.card, t.name)).join(", "), attr: { dir: "auto" } });
        row.onclick = () => void this.openDetail(t.path);
        row.addEventListener("keydown", (e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          void this.openDetail(t.path);
        });
      }
    }
  }

  // a card (the same on the board and the team view, three lines at most): project › parent (a click opens the parent), the name, then the
  // exception tag, the kanban steps, subtasks, the link to my work and the people. `person` owns the card it sits on (team) and is left out
  private renderCard(host: HTMLElement, t: Task, person: string): void {
    const { statuses } = this.plugin.settings;
    const card = host.createDiv({ cls: "ogantt-kcard", attr: { tabindex: "0", role: "listitem", "data-path": t.path } });
    card.toggleClass("is-selected", t.path === this.selectedPath);
    card.toggleClass("is-disabled", this.disabled.has(t.path));
    card.toggleClass("is-done", !isOpen(t, statuses));
    const project = this.projects ? this.projectOf(t) : "";
    if (project || t.parent) {
      // each name keeps its own direction while the order and alignment follow the interface (a Hebrew name doesn't push the line right)
      const crumb = card.createDiv({ cls: "ogantt-kcard-crumb" });
      // the project's colour as a dot, the same as its heading on the Timeline, so a project reads the same in every layout
      if (project) crumb.createSpan({ cls: "ogantt-kcard-dot", attr: { "aria-hidden": "true" } }).style.background = this.folderColor(project);
      if (project) crumb.createSpan({ text: project, attr: { dir: "auto" } });
      if (project && t.parent) crumb.appendText(" › ");
      if (t.parent) {
        const parent = t.parent;
        crumb.createSpan({ cls: "ogantt-kcard-parent", text: this.nameOf(parent), attr: { dir: "auto" } }).addEventListener("click", (e) => {
          e.stopPropagation(); // not the card's click (which opens this task)
          void this.openDetail(parent);
        });
      }
    }
    const title = card.createDiv({ cls: "ogantt-kcard-title" });
    const locked = this.readOnly(t.path);
    if (locked) setIcon(title.createSpan({ cls: "ogantt-name-icon", attr: { "aria-label": tr().readOnlyHint, title: tr().readOnlyHint } }), "lock");
    title.createSpan({ text: t.name, attr: { dir: "auto" } });
    // the people follow the name, at the end of its line (no line of their own)
    const people = t.assignees.filter((a) => linkLabel(a) !== person);
    if (people.length) {
      const names = people.map(linkLabel).join(", ");
      const who = title.createSpan({ cls: "ogantt-kcard-people", attr: { title: names, "aria-label": names } });
      for (const a of people.slice(0, 2)) this.avatar(who, a);
      if (people.length > 2) who.createSpan({ cls: "ogantt-kcard-more", text: `+${people.length - 2}` });
    }
    const foot = card.createDiv({ cls: "ogantt-kcard-foot" });
    this.excTag(foot, this.exceptionsOf(t), this.layout === "board", 2);
    if (t.kind === "kanban") this.boardCue(foot, t);
    this.subtaskPill(foot, this.kids.get(t.path) ?? []);
    // the link to my work says which way in words (an icon alone reads as a URL)
    const link = this.linked.get(t.path);
    if (link) {
      const rel = foot.createSpan({ cls: "ogantt-kcard-linked", attr: { title: tr().linkedToYou(link.names.join(", ")) } });
      setIcon(rel.createSpan({ cls: "ogantt-exc-icon", attr: { "aria-hidden": "true" } }), "link");
      rel.createSpan({ text: link.mine ? tr().youWaitOn : tr().waitsOnYou });
    }
    // what got done since the last daily scrum (the task itself or its cards): the board says it, so nobody has to
    const fresh = this.doneSince(t);
    if (this.layout === "board" && (fresh.on || fresh.cards.length)) {
      const tip = this.doneTip(t, fresh);
      const pill = foot.createSpan({ cls: "ogantt-kcard-fresh", attr: { title: tip, "aria-label": tip } });
      setIcon(pill.createSpan({ cls: "ogantt-exc-icon", attr: { "aria-hidden": "true" } }), "check-check");
      pill.createSpan({ text: fresh.on ? weekdayOf(fresh.on) : tr().stepsDone(fresh.cards.length) });
    }
    // a blocked card says what it waits for (what the daily scrum asks)
    if (t.blocker && statusGroupOf(statuses, t.status) === "deferred") card.createDiv({ cls: "ogantt-kcard-why", text: t.blocker, attr: { dir: "auto" } });
    card.onclick = () => void this.openDetail(t.path);
    card.addEventListener("keydown", (e) => {
      if (e.target !== card) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        void this.openDetail(t.path);
      } else if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
        e.preventDefault();
        this.openRowMenu(t, card);
      }
    });
    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.openRowMenu(t, e);
    });
    // the status changes by dragging (keyboard and touch: the Status field of the details, opened by Enter or a tap); read-only cards don't move
    if (this.layout === "board" && !locked) this.makeDraggableTask(card, t.path);
  }

  // make a column a drop target: a card dropped there takes its status (undoable); a blocked column opens the details so the reason can be written
  private dropToStatus(col: HTMLElement, s: StatusDef): void {
    const clear = () => col.removeClass("is-drop-target");
    col.addEventListener("dragover", (e: DragEvent) => {
      if (this.dragPath == null) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      col.dataset.dropLabel = s.label;
      col.addClass("is-drop-target");
    });
    col.addEventListener("dragleave", (e: DragEvent) => {
      if (!col.contains(e.relatedTarget as Node | null)) clear();
    });
    col.addEventListener("drop", (e: DragEvent) => {
      e.preventDefault();
      clear();
      const path = e.dataTransfer?.getData("text/plain") || this.dragPath;
      this.dragPath = null;
      const t = path ? this.tasks.find((x) => x.path === path) : undefined;
      if (!t || t.status === s.id) return;
      void (async () => {
        if (!(await this.mutate(tr().undoEdit(t.name), [t.path], () => writeStatus(this.app, t.path, this.plugin.settings, s.id, dayToStr(this.today()))))) return;
        await this.refresh();
        if (s.group !== "deferred") return;
        this.askWhy = t.path;
        await this.openDetail(t.path);
      })();
    });
  }

  // the current sprint (a note tagged #sprint whose dates hold today) in one line: its name (carrying the goal) and which workday it is; a click opens it
  // the bar after the line compares by length: the share of work done (the fill) and of days gone (the mark); a fill short of the mark is behind
  private sprintLine(host: HTMLElement): void {
    const s = this.sprintStats();
    if (!s) return;
    const line = host.createEl("button", { cls: "ogantt-sprint", attr: { title: tr().sprintHint } });
    setIcon(line.createSpan({ cls: "ogantt-exc-icon", attr: { "aria-hidden": "true" } }), "flag");
    line.createSpan({ cls: "ogantt-sprint-name", text: s.task.name, attr: { dir: "auto" } });
    line.createSpan({ text: tr().sprintLine(s.day, s.days, s.done, s.total) });
    const bar = line.createSpan({ cls: "ogantt-sprint-bar", attr: { "aria-hidden": "true" } });
    bar.createSpan({ cls: "ogantt-sprint-done" }).style.width = `${(100 * s.done) / Math.max(1, s.total)}%`;
    bar.createSpan({ cls: "ogantt-sprint-today" }).style.insetInlineStart = `${(100 * Math.min(s.day, s.days)) / Math.max(1, s.days)}%`;
    line.onclick = () => void this.openDetail(s.task.path);
  }

  // the current sprint in numbers: which workday, how many, done and all of its work. The team's sprint, so the whole board counts, this tab's filters aside
  private sprintStats(): { task: Task; day: number; days: number; done: number; total: number } | undefined {
    const sprint = this.currentSprint();
    if (!sprint) return undefined;
    const { statuses } = this.plugin.settings;
    const finished = (t: Task) => statusGroupOf(statuses, t.status) === "completed";
    const inSprint = this.cardsOf(this.tasks.filter((t) => !this.disabled.has(t.path))).filter((t) => statusGroupOf(statuses, t.status) !== "cancelled" && boardWhen(t, finished(t), sprint.from, sprint.to) === "now");
    const cal = scheduleOptions(this.plugin.settings).cal;
    return { task: sprint.task, day: Math.max(1, workdaysBetween(sprint.from, this.today(), cal)), days: workdaysBetween(sprint.from, sprint.to, cal), done: inSprint.filter(finished).length, total: inSprint.length };
  }

  // the status report for a manager (Markdown): health and headline (by hand), the sprint, what needs attention (reasons and people), done,
  // now, next and per-project counts (from the board). Built from the whole board (this tab's filters aside), each task in one section, empty
  // sections left out, in the People cards' words (Now, Next, Done since). "Needs attention" is the Attention preset's set (blocked, overdue,
  // urgent), strongest first: what a manager can act on; date clashes and interruptions are the leader's own to sort out
  // Laid out to be read in a glance in Obsidian and still plain in a message: the health as a coloured callout, the asks as a table,
  // counts in the headings, text progress bars
  statusReport(health: Health | "", headline: string): string {
    const { statuses, dateFormat, autoStatus } = this.plugin.settings;
    const today = this.today();
    const date = (d: string | number) => formatDate(typeof d === "number" ? dayToStr(d) : d, dateFormat);
    const asks = (t: Task) => this.exceptionsOf(t).filter((e) => ATTENTION.includes(e));
    const rank = (t: Task) => {
      const e = asks(t)[0];
      return e ? EXCEPTIONS.indexOf(e) : EXCEPTIONS.length;
    };
    const base = this.comparator();
    const tasks = this.cardsOf(this.tasks.filter((t) => !this.disabled.has(t.path))).sort((a, b) => rank(a) - rank(b) || base(a, b));
    const [from, to] = this.window();
    const { notStarted, started } = autoStatusTargets(statuses, autoStatus);
    const sec = reportSections(tasks, statuses, notStarted, (t) => asks(t).length > 0, from, to);
    // names are isolated, so a line starting with a Hebrew name keeps the report's direction
    const who = (t: Task) => t.assignees.map((a) => isolate(linkLabel(a))).join(", ");
    const item = (t: Task, detail = "") => `- ${isolate(t.name)}${t.assignees.length ? ` — ${who(t)}` : ""}${detail ? ` · ${detail}` : ""}`;
    const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
    const bar = (n: number, total: number) => {
      const on = Math.round((10 * n) / Math.max(1, total));
      return "▰".repeat(on) + "▱".repeat(10 - on);
    };
    const interrupts = (t: Task) => (t.interrupts ?? []).filter((p) => this.ints.interrupted.get(p)?.some((u) => u.path === t.path));
    // the reasons: what blocked work waits for, and what urgent work interrupts
    const why = (t: Task) => asks(t).map((e) => {
      const reason = this.reasonOf(t, e);
      if (e === "blocked" && t.blocker) return `${reason}: ${isolate(t.blocker)}`;
      const hit = e === "urgent" ? interrupts(t) : [];
      return hit.length ? `${reason}; ${tr().interruptsWhat(hit.map((p) => isolate(this.nameOf(p))).join(", "))}` : reason;
    }).join("; ");
    const how = (t: Task) => (t.cards ? tr().cardsChecked(t.cards.done, t.cards.total) : t.progress ? `${t.progress}%` : "");
    const board = this.folder ? this.folder.split("/").pop()! : tr().vaultRoot;
    const out = [`## ${board} · ${date(today)}`];
    // the health leads as a callout in its colour (a quote outside Obsidian); the headline is its body
    const body = headline ? headline.split(/\r?\n/).map((l) => `> ${isolate(l)}`) : [];
    if (health) out.push("", `> [!${HEALTH_CALLOUT[health]}] ${tr()[HEALTH_LABEL[health]]}`, ...body);
    else if (headline) out.push("", isolate(headline));
    const s = this.sprintStats();
    if (s) out.push("", `**${s.task.name}**`, `${bar(s.done, s.total)} ${tr().sprintLine(s.day, s.days, s.done, s.total)}`);
    const section = (title: string, n: number, lines: string[]) => {
      if (n) out.push("", `### ${title} (${n})`, ...lines);
    };
    // the asks as a table: what, who, why
    section(tr().reportAttention, sec.attention.length, [`| ${tr().colTask} | ${tr().fieldAssignee} | ${tr().fieldAttention} |`, "| --- | --- | --- |", ...sec.attention.map((t) => `| ${cell(isolate(t.name))} | ${cell(who(t))} | ${cell(why(t))} |`)]);
    section(tr().doneSince(date(from)), sec.done.length, sec.done.map((t) => item(t)));
    section(tr().teamNow, sec.now.length, sec.now.map((t) => item(t, how(t))));
    // what comes next leads with its date, so the list reads in order
    section(tr().teamNext, sec.next.length, sec.next.map((t) => (anchorStart(t) ? `- ${date(anchorStart(t)!)} · ${item(t).slice(2)}` : item(t))));
    // per project (only across two or more): a done bar and the headings' open counts
    const projects = new Map<string, Task[]>();
    for (const t of tasks) projects.set(this.projectOf(t), [...(projects.get(this.projectOf(t)) ?? []), t]);
    if (projects.size > 1) section(tr().reportProjects, projects.size, [`| ${tr().reportProject} | ${tr().fieldProgress} | ${tr().fieldStatus} |`, "| --- | --- | --- |", ...[...projects].sort(([a], [b]) => a.localeCompare(b)).map(([p, list]) => {
      const sum = subtaskSummary(list, statuses);
      return `| ${cell(isolate(p || board))} | ${bar(sum.done, sum.total)} ${sum.done}/${sum.total} | ${tr().headingCount(...openCounts(list.filter((t) => isOpen(t, statuses)), statuses, today, started))} |`;
    })]);
    return out.join("\n") + "\n";
  }

  // what the plan assistant sees of this board: its live tasks (disabled ones left out), the statuses, the work week, today, who asks
  aiBoard(): AiBoard {
    const sprint = this.currentSprint();
    return {
      sprint: sprint && { name: sprint.task.name, from: sprint.from, to: sprint.to },
      tasks: this.tasks.filter((t) => !this.disabled.has(t.path)),
      statuses: this.plugin.settings.statuses,
      opts: scheduleOptions(this.plugin.settings),
      today: this.today(),
      folder: this.folder,
      me: this.me(),
      attention: (t) => this.exceptionsOf(t).map((e) => EXC_TEXT[e]().toLowerCase()),
      read: async (path) => {
        const f = this.app.vault.getAbstractFileByPath(path);
        return f instanceof TFile ? this.app.vault.cachedRead(f) : "";
      },
    };
  }

  // apply a proposal the user approved: the tasks' own edits, then the cascade from the moved ones, all as one undoable step
  // (the cascade is worked out again on the live board, so it matches the proposal unless a note changed meanwhile)
  async applyProposal(edits: Edit[]): Promise<boolean> {
    const s = this.plugin.settings;
    const own = edits.filter((e) => !e.cascaded);
    const roots = own.filter((e) => "start" in e.after || "end" in e.after).map((e) => e.path);
    const paths = [...new Set([...edits.map((e) => e.path), ...roots.flatMap((p) => this.cascadePaths(p))])];
    const ok = await this.mutate(tr().aiUndoLabel, paths, async () => {
      for (const e of own) {
        const t = this.tasks.find((x) => x.path === e.path);
        if (!t) continue;
        const a = e.after;
        if (roots.includes(t.path)) {
          // a milestone keeps only its date; any other dated task has a start (one with no due date is a single day)
          const start = a.start ?? t.start;
          const end = a.end ?? t.end ?? start;
          if (t.milestone) await writeDates(this.app, s, t.path, end!, end!, true);
          else await writeDates(this.app, s, t.path, start!, end!, false);
          if (!t.milestone) t.start = start;
          t.end = end; // mirrored in memory for the cascade
        }
        // the status first: leaving Blocked clears an old reason, then a new reason is written
        if (a.status !== undefined) await writeStatus(this.app, t.path, s, a.status, dayToStr(this.today()));
        if (a.assignees) await writeField(this.app, t.path, s.keys.assignee, a.assignees.length > 1 ? a.assignees : a.assignees[0]);
        if (a.blocker !== undefined) await writeField(this.app, t.path, s.keys.blocker, a.blocker || undefined);
      }
      if (roots.length) await this.cascade(roots);
    });
    await this.refresh();
    return ok;
  }

  // the work plan (ת"ע) as a PowerPoint deck for a quarter or a half (this or the next), saved where attachments go. The deck uses the
  // board's own project colours, so it matches the board
  exportWorkPlan(): void {
    const mon = dateFormat({ month: "short" });
    const label = (p: PlanPeriod) => {
      const [s, e] = [new Date(dayIndex(p.start) * 86_400_000), new Date(dayIndex(p.end) * 86_400_000)];
      const months = e.getUTCMonth() - s.getUTCMonth() + 1;
      return tr().workPlanPeriod(months === 3, Math.floor(s.getUTCMonth() / months) + 1, s.getUTCFullYear(), `${mon.format(s)}–${mon.format(e)}`);
    };
    new PickModal(this.app, planPeriods(this.today()), label, tr().workPlanPick, (period) => void (async () => {
      try {
        const s = this.plugin.settings;
        const board = this.folder ? this.folder.split("/").pop()! : tr().vaultRoot;
        const folderColors = [...new Set(this.tasks.map((t) => t.groups[0]).filter((g): g is string => !!g))].map((name) => ({ name, color: this.folderColor(name) }));
        const plan = buildWorkPlan({ tasks: this.tasks.filter((t) => !this.disabled.has(t.path)), settings: { statuses: s.statuses, tagColors: s.tagColors, folderColors }, period, board, today: this.today() });
        if (!plan.pages.some((p) => p.rows.length)) return void new Notice(tr().workPlanEmpty);
        // the deck library loads only when a deck is made, so it costs nothing at startup
        const { workPlanPptx } = await import("./workplan-pptx");
        const path = await this.app.fileManager.getAvailablePathForAttachment(`${board} ${period.start.slice(0, 7)}.pptx`.replace(/[\\/:*?"<>|]/g, "-"), "/");
        const file = await this.app.vault.createBinary(path, await workPlanPptx(plan));
        // Obsidian can't show a deck: Open hands it to the system's app (PowerPoint)
        const open = (this.app as unknown as { openWithDefaultApp?: (path: string) => void }).openWithDefaultApp;
        this.buttonNotice(tr().exportDone(file.path), tr().exportOpen, () => open?.call(this.app, file.path), 8000);
      } catch (e) {
        console.error(e);
        new Notice(tr().workPlanFailed);
      }
    })()).open();
  }

  // open the report dialog (from the board command and the ⋯ menu)
  openReport(): void {
    new ReportModal(this.app, (health, headline) => this.statusReport(health, headline)).open();
  }

  // the current window: the sprint, else two weeks either side of
  // today; where the Board and the Timeline fold
  private window(): [number, number] {
    const sprint = this.currentSprint();
    return sprint ? [sprint.from, sprint.to] : [this.today() - FOLD_DAYS, this.today() + FOLD_DAYS];
  }

  // the current sprint: a note tagged #sprint
  // whose dates hold today (the later-starting one when they overlap), and its span
  private currentSprint(): { task: Task; from: number; to: number } | undefined {
    const today = this.today();
    const span = (t: Task) => [anchorStart(t) ?? anchorEnd(t), anchorEnd(t) ?? anchorStart(t)].map((d) => (d ? dayIndex(d) : NaN));
    const task = this.tasks.filter((t) => isSprint(t) && span(t)[0] <= today && span(t)[1] >= today).sort((a, b) => span(b)[0] - span(a)[0])[0];
    return task && { task, from: span(task)[0], to: span(task)[1] };
  }

  // other people's open tasks linked by a dependency to my open work (this device's name) → which way (I wait on it, or it waits on me) and my tasks
  private linkedToMe(): Map<string, { mine: boolean; names: string[] }> {
    const out = new Map<string, { mine: boolean; names: string[] }>();
    const me = this.me();
    if (!me) return out;
    const { statuses } = this.plugin.settings;
    const mineOf = (t: Task) => t.assignees.some((a) => linkLabel(a) === me);
    const open = this.tasks.filter((t) => isOpen(t, statuses));
    const mine = open.filter(mineOf);
    for (const t of open) {
      if (mineOf(t)) continue;
      const waiting = mine.filter((m) => m.deps.some((d) => d.path === t.path)); // my tasks waiting on this one
      const names = [...waiting, ...mine.filter((m) => t.deps.some((d) => d.path === m.path))].map((m) => m.name);
      if (names.length) out.set(t.path, { mine: waiting.length > 0, names });
    }
    return out;
  }

  // the last daily scrum's day: the last workday before today (Friday on a Monday)
  private since(): number {
    return prevWorkday(this.today() - 1, scheduleOptions(this.plugin.settings).cal);
  }

  // what got done on a task since that day: the task itself (the day it entered Completed) and its ticked steps (their ✅ date, or the day this computer first saw the tick)
  private doneSince(t: Task): { on?: string; cards: CardDone[] } {
    const since = this.since();
    const finished = statusGroupOf(this.plugin.settings.statuses, t.status) === "completed";
    return {
      on: finished && t.completed && dayIndex(t.completed) >= since ? t.completed : undefined,
      cards: (this.cardSteps.get(t.path)?.done ?? []).filter((c) => dayIndex(c.on) >= since),
    };
  }

  // its tooltip (when it was done, which cards)
  private doneTip(t: Task, d: { on?: string; cards: CardDone[] }): string {
    const { statuses, dateFormat } = this.plugin.settings;
    const status = statuses.find((s) => s.id === t.status)?.label ?? "";
    const day = weekdayOf(dayToStr(this.since()));
    return [d.on ? `${status} ${formatDate(d.on, dateFormat)}` : "", d.cards.length ? tr().stepsSince(d.cards.length, day, d.cards.map((c) => withoutName(c.card, t.name)).join(", ")) : ""].filter(Boolean).join("\n");
  }

  // this device's name (the "My work" setting), as a display name
  private me(): string | undefined {
    const me = (this.app.loadLocalStorage(ME_KEY) as string | null)?.trim();
    return me ? linkLabel(me) : undefined;
  }

  // which folder (project) under the board's folder; "" directly in it
  private projectOf(t: Task): string {
    const rel = (this.folder ? t.path.slice(this.folder.length + 1) : t.path).split("/");
    return rel.length > 1 ? rel[0] : "";
  }

  // the tasks that become cards: no sprint notes, and no
  // parent whose subtasks are on show (nothing counted twice)
  private cardsOf(list: Task[]): Task[] {
    const on = new Set(list.map((t) => t.path));
    return list.filter((t) => !isSprint(t) && !(this.kids.get(t.path) ?? []).some((k) => on.has(k.path)));
  }

  // a task's exceptions (none for a disabled task or a sprint note)
  private exceptionsOf(t: Task): Exception[] {
    return this.disabled.has(t.path) || isSprint(t) ? [] : exceptionsOf(t, this.plugin.settings.statuses, this.today(), this.conflicts, this.ints);
  }

  // pixels-per-day; Fit derives it from the pane width (falls back to scrolling below MIN_PPD)
  private computePpd(): number {
    if (this.zoom !== "Fit") return pxPerDay(this.zoom);
    const totalDays = Math.max(1, this.range.max - this.range.min + 1);
    // fit as if the detail panel were closed, so opening or closing it keeps the scale
    this.fitWidth = this.fitBase();
    const avail = this.fitWidth - this.tableWidth(false) - FIT_SCROLLBAR_PAD;
    if (avail <= 0) return pxPerDay("Week"); // not laid out yet
    return Math.max(MIN_PPD, Math.floor(avail / totalDays));
  }

  // the board's width with the detail panel closed
  private fitBase(): number {
    const panel = this.detailEl?.hasClass("is-open") && !Platform.isPhone ? this.detailEl.offsetWidth : 0;
    return (this.gridHost?.clientWidth ?? 0) + panel;
  }

  // ----- table columns -----
  // visible columns (name always; the rest per settings, in columnOrder)
  private visibleColumns(withPanel = true): ColumnDef[] {
    const cols = visibleColumns(this.columns(), this.plugin.settings.visibleColumns ?? [], this.plugin.settings.columnOrder ?? []);
    // while the panel is open, only the name column (so the panel doesn't crush the timeline)
    return withPanel && this.detailEl?.hasClass("is-open") && !Platform.isPhone ? cols.filter((c) => c.kind === "name") : cols;
  }

  // today in the configured timezone
  private today(): number {
    return todayIndex(undefined, this.plugin.settings.tz);
  }
  // every column definition (built-ins, then custom fields); rebuilt only when the custom fields change
  private columnCache: { sig: string; cols: ColumnDef[] } | null = null;
  private columns(): ColumnDef[] {
    const sig = JSON.stringify(validCustomFields(this.plugin.settings));
    if (this.columnCache?.sig !== sig) this.columnCache = { sig, cols: allColumns(this.plugin.settings) };
    return this.columnCache.cols;
  }
  // total table width (sum of visible column widths)
  private tableWidth(withPanel = true): number {
    // called on every scroll, so the definitions aren't looked up again per column
    const widths = this.plugin.settings.columnWidths;
    return this.visibleColumns(withPanel).reduce((w, c) => w + columnWidth(c, widths), 0);
  }

  // effective column width (user override > default)
  private colW(id: string): number {
    const def = this.columns().find((c) => c.id === id);
    return def ? columnWidth(def, this.plugin.settings.columnWidths) : 0;
  }

  // auto-fit a column to its content (grip double-press): every task row's cell for it, drawn or not, is painted off-screen and measured
  private autoFitColumn(id: string, th: HTMLElement): void {
    const col = this.visibleColumns().find((c) => c.id === id);
    if (!col) return;
    const probe = this.tbodyEl.createDiv({ cls: "ogantt-measure-probe" });
    const noWidth = new Map([[id, 0]]);
    this.rows.forEach((row, i) => { if (row.kind === "task") this.renderRow(probe, row, i, [col], noWidth); });
    // remove inline widths while measuring so the measuring class applies without !important
    const saved = th.style.width;
    const cells = [th, ...Array.from(probe.querySelectorAll<HTMLElement>(".ogantt-td"))];
    cells.forEach((el) => {
      el.style.removeProperty("width");
      el.addClass("ogantt-measure");
    });
    const w = Math.max(40, ...cells.map((el) => el.offsetWidth)) + 2;
    th.removeClass("ogantt-measure");
    th.style.width = saved;
    probe.remove();
    this.plugin.settings.columnWidths[id] = w;
    void this.plugin.saveLook(); // persist and redraw the open boards
  }
  // clicking a header toggles sort column/direction (persisted)
  private toggleSort(id: string, refocus = false): void {
    const s = this.plugin.settings;
    if (s.sortBy === id) s.sortDir = s.sortDir === "asc" ? "desc" : "asc";
    else {
      s.sortBy = id;
      s.sortDir = "asc";
    }
    this.saveSoon();
    this.rerender();
    // after a keyboard sort, focus goes back to the rebuilt header
    if (refocus) this.boardMain?.querySelector<HTMLElement>(`.ogantt-th[data-col="${CSS.escape(id)}"]`)?.focus();
  }

  // toggle a column's visibility and persist
  private setColumnVisible(id: string, on: boolean): void {
    const s = this.plugin.settings;
    Object.assign(s, toggleColumn(this.columns(), s.visibleColumns ?? [], s.columnOrder ?? [], id, on));
    void this.plugin.saveLook(); // columns are shared, so every open board and the settings tab redraw
  }

  // move a column one up or down (within the shown or the hidden ones); true when it moved
  private shiftColumn(id: string, dir: -1 | 1): boolean {
    const s = this.plugin.settings;
    const order = moveColumn(this.columns(), s.visibleColumns ?? [], s.columnOrder ?? [], id, dir);
    if (!order) return false;
    s.columnOrder = order;
    void this.plugin.saveLook();
    return true;
  }

  // ----- unified filter -----

  // save + redraw board (popovers survive on body)
  // the filters are saved as the tab's state (with the workspace)
  private commitFilters(): void {
    this.app.workspace.requestSaveLayout();
    this.rerender();
  }

  // after a status id change, this tab's filters follow it
  renameStatusFilter(from: string, to: string): void {
    for (const f of this.filters) if (f.kind === "category" && f.field === "status") f.values = f.values.map((v) => (v === from ? to : v));
    this.app.workspace.requestSaveLayout();
  }

  // date operator label
  private dateOpLabel(op: DateOp): string {
    const s = tr();
    switch (op) {
      case "is": return s.dfOpIs;
      case "before": return s.dfOpBefore;
      case "after": return s.dfOpAfter;
      case "onOrBefore": return s.dfOpOnOrBefore;
      case "onOrAfter": return s.dfOpOnOrAfter;
      case "empty": return s.dfOpEmpty;
      case "notEmpty": return s.dfOpNotEmpty;
    }
  }
  // category operator label
  private catOpLabel(op: CategoryOp): string {
    const s = tr();
    switch (op) {
      case "is": return s.dfOpIs;
      case "isNot": return s.dfOpIsNot;
      case "empty": return s.dfOpEmpty;
      case "notEmpty": return s.dfOpNotEmpty;
    }
  }
  // relative unit label
  private dateUnitLabel(u: DateUnit): string {
    return u === "day" ? tr().dfDay : u === "week" ? tr().dfWeek : tr().dfMonth;
  }
  // text (name) operator label
  private textOpLabel(op: TextOp): string {
    const s = tr();
    switch (op) {
      case "is": return s.dfOpIs;
      case "isNot": return s.dfOpIsNot;
      case "contains": return s.textOpContains;
      case "notContains": return s.textOpNotContains;
      case "startsWith": return s.textOpStartsWith;
      case "endsWith": return s.textOpEndsWith;
    }
  }
  // a filter's field label
  private filterFieldLabel(f: Filter): string {
    if (f.kind === "date") return f.field === "start" ? tr().fieldStart : tr().fieldDue;
    if (f.kind === "text") return tr().fieldName;
    switch (f.field) {
      case "status": return tr().fieldStatus;
      case "statusGroup": return tr().fieldStatusGroup;
      case "assignee": return tr().fieldAssignee;
      case "tag": return tr().fieldTags;
      case "attention": return tr().fieldAttention;
    }
  }
  // chip & menu icon
  private filterIcon(f: Filter): string {
    if (f.kind === "date") return "calendar";
    if (f.kind === "text") return "type";
    switch (f.field) {
      case "status": return "filter";
      case "statusGroup": return "flag";
      case "assignee": return "user";
      case "tag": return "tag";
      case "attention": return "alert-triangle";
    }
  }
  // a category value's label ("" = unset; status maps id→label)
  private catValueLabel(field: CategoryField, value: string): string {
    if (value === "") return tr().noneLabel; // unset
    if (field === "status") return this.plugin.settings.statuses.find((s) => s.id === value)?.label ?? value;
    if (field === "statusGroup") return statusGroupLabel(value as StatusGroup);
    if (field === "attention") return value === "blocked" ? tr().attBlocked : value === "overdue" ? tr().excOverdue : tr().excUrgent;
    return value;
  }
  // available category values, plus an "unset" ("") entry at the end
  private filterFieldValues(field: CategoryField): [string, string][] {
    let base: [string, string][];
    if (field === "status") base = this.plugin.settings.statuses.map((s) => [s.id, s.label] as [string, string]);
    // the four groups are fixed, so list them all even when no status currently uses one
    else if (field === "statusGroup") base = STATUS_GROUPS.map((g) => [g, statusGroupLabel(g)] as [string, string]);
    else if (field === "attention") base = ATTENTION.map((a) => [a, this.catValueLabel("attention", a)] as [string, string]);
    else if (field === "assignee") base = this.assigneeList().map((a) => [a, linkLabel(a)] as [string, string]);
    else {
      // one entry per tag whatever the case (the headings' spelling)
      const spelling = new Map<string, string>();
      for (const tg of this.tasks.flatMap((t) => t.tags)) spelling.set(tg.toLowerCase(), tagSpelling(spelling.get(tg.toLowerCase()), tg));
      base = [...spelling.values()].sort().map((tg) => [tg, tg] as [string, string]);
    }
    return [...base, ["", tr().noneLabel]]; // allow filtering by "unset"
  }

  // one-line chip summary
  private filterSummary(f: Filter): string {
    const field = this.filterFieldLabel(f);
    if (f.kind === "date") {
      const op = this.dateOpLabel(f.op);
      const v = f.value;
      let val = "";
      if (v) {
        const fmt = this.plugin.settings.dateFormat;
        if (v.kind === "preset") val = v.preset === "today" ? tr().today : v.preset === "yesterday" ? tr().dfYesterday : tr().dfTomorrow;
        else if (v.kind === "specific") val = formatDate(v.date, fmt);
        else if (v.kind === "relative") val = `${v.amount} ${this.dateUnitLabel(v.unit)} ${v.dir === "ago" ? tr().dfAgo : tr().dfFromNow}`;
        else val = `${formatDate(v.from, fmt)} ${tr().dfRangeTo} ${formatDate(v.to, fmt)}`;
      }
      return val ? `${field}: ${op} ${val}` : `${field}: ${op}`;
    }
    if (f.kind === "text") {
      const q = f.value.trim();
      return q ? `${field}: ${this.textOpLabel(f.op)} "${q}"` : `${field}: ${this.textOpLabel(f.op)}`;
    }
    if (f.op === "empty" || f.op === "notEmpty") return `${field}: ${this.catOpLabel(f.op)}`;
    const shown = f.values.length ? f.values.map((v) => this.catValueLabel(f.field, v)).join(", ") : "…";
    return f.op === "isNot" ? `${field}: ${this.catOpLabel("isNot")} ${shown}` : `${field}: ${shown}`;
  }

  // the filter row: add button + chips + match toggle
  private renderFilterBar(): void {
    const host = this.filterHost;
    host.empty();
    const filters = this.filters;
    // a leading label so the row reads as "Filters"
    setIcon(host.createSpan({ cls: "ogantt-filterbar-ico" }), "filter");
    host.createSpan({ cls: "ogantt-filterbar-label", text: tr().dfLabel });
    // presets (left, outside the frame)
    const presetBtn = host.createEl("button", { cls: "ogantt-preset-btn clickable-icon" });
    setIcon(presetBtn.createSpan({ cls: "ogantt-opt-ico" }), "bookmark");
    presetBtn.createSpan({ text: tr().presetLabel });
    setIcon(presetBtn.createSpan({ cls: "ogantt-preset-caret" }), "chevron-down");
    presetBtn.onclick = () => this.openPresetMenu(presetBtn);
    // a bordered group holding add-button + chips
    const group = host.createDiv({ cls: "ogantt-filter-group" });
    // add a filter
    const add = group.createEl("button", { cls: "ogantt-filter-add clickable-icon" });
    setIcon(add.createSpan({ cls: "ogantt-opt-ico" }), "list-filter");
    add.createSpan({ text: tr().dfAdd });
    add.onclick = () => this.openAddFilterMenu(add);
    // active-filter chips (click to edit, × to remove)
    filters.forEach((f, i) => {
      const chip = group.createDiv({ cls: "ogantt-filter-chip" });
      const open = chip.createEl("button", { cls: "ogantt-filter-chip-main", attr: { "data-focus": `filter-${i}` } });
      setIcon(open.createSpan({ cls: "ogantt-filter-chip-ico" }), this.filterIcon(f));
      open.createSpan({ text: this.filterSummary(f) });
      open.onclick = () => this.openFilterEditor(chip, i);
      const x = chip.createEl("button", { cls: "ogantt-filter-chip-x", attr: { "aria-label": tr().dfRemove } });
      setIcon(x, "x");
      x.onclick = () => { filters.splice(i, 1); this.commitFilters(); };
    });
    // with 2+ filters, a match-all/any toggle on the right
    if (filters.length >= 2) {
      const match = host.createDiv({ cls: "ogantt-filter-match" });
      match.createSpan({ cls: "ogantt-filter-match-label", text: tr().dfMatchLabel });
      const sel = match.createEl("select", { cls: "dropdown" });
      for (const [val, text] of [["all", tr().dfMatchAll], ["any", tr().dfMatchAny]] as [FilterMatch, string][]) {
        const o = sel.createEl("option", { text, value: val });
        if (val === this.filterMatch) o.selected = true;
      }
      sel.onchange = () => { this.filterMatch = sel.value as FilterMatch; this.commitFilters(); };
    }
  }

  // the chip for folded past work (beside the filter chips; a click shows or folds it)
  private historyChip(n: number, from: number): void {
    const group = this.filterHost.querySelector(".ogantt-filter-group");
    if (!group || !n) return;
    const chip = group.createDiv({ cls: "ogantt-filter-chip ogantt-history-chip" });
    const btn = chip.createEl("button", { cls: "ogantt-filter-chip-main", attr: { title: tr().olderHint(formatDate(dayToStr(from), this.plugin.settings.dateFormat)) } });
    setIcon(btn.createSpan({ cls: "ogantt-filter-chip-ico" }), "archive");
    btn.createSpan({ text: this.history ? tr().hideOlder(n) : tr().olderDone(n) });
    btn.onclick = () => {
      this.history = !this.history;
      this.rerender();
    };
  }

  // "Add filter" → field picker
  private openAddFilterMenu(anchor: HTMLElement): void {
    const m = new Menu();
    // name (text)
    m.addItem((i) => i.setTitle(tr().fieldName).setIcon("type").onClick(() => {
      this.filters.push({ kind: "text", field: "name", op: "contains", value: "" });
      this.commitFilters();
      this.openLastFilterEditor();
    }));
    const addCat = (field: CategoryField, label: string, icon: string) => {
      m.addItem((i) => i.setTitle(label).setIcon(icon).onClick(() => {
        this.filters.push({ kind: "category", field, op: "is", values: [] });
        this.commitFilters();
        this.openLastFilterEditor();
      }));
    };
    addCat("status", tr().fieldStatus, "filter");
    addCat("statusGroup", tr().fieldStatusGroup, "flag");
    addCat("assignee", tr().fieldAssignee, "user");
    addCat("attention", tr().fieldAttention, "alert-triangle");
    if (this.tasks.some((t) => t.tags.length > 0)) addCat("tag", tr().fieldTags, "tag");
    const addDate = (field: DateField, label: string) => {
      m.addItem((i) => i.setTitle(label).setIcon("calendar").onClick(() => {
        this.filters.push({ kind: "date", field, op: "onOrAfter", value: { kind: "preset", preset: "today" } });
        this.commitFilters();
        this.openLastFilterEditor();
      }));
    };
    addDate("start", tr().fieldStart);
    addDate("end", tr().fieldDue);
    const r = anchor.getBoundingClientRect();
    m.showAtPosition({ x: r.left, y: r.bottom + 4 }, anchor.doc);
  }

  // open the just-added filter's editor
  private openLastFilterEditor(): void {
    const chips = this.filterHost.querySelectorAll(".ogantt-filter-chip");
    const last = chips[chips.length - 1] as HTMLElement | undefined;
    if (last) this.openFilterEditor(last, this.filters.length - 1);
  }

  // built-in presets (not deletable)
  private builtinPresets(): FilterPreset[] {
    const today: DateValue = { kind: "preset", preset: "today" };
    const open: Filter = { kind: "category", field: "statusGroup", op: "isNot", values: ["completed", "cancelled"] };
    const me = this.me();
    return [
      // role entry points (they switch the grouping too): Overview = outstanding work by project (folder), Team = the same by person; undated and
      // future work included. Upcoming 2 weeks = work starting after today and within two weeks (the filter chips spell the range out)
      { name: tr().presetOverview, filterMatch: "all", groupBy: "folder", filters: [open] },
      { name: tr().presetUpcoming, filterMatch: "all", filters: [open,
        { kind: "date", field: "start", op: "after", value: today },
        { kind: "date", field: "start", op: "onOrBefore", value: { kind: "relative", amount: 2, unit: "week", dir: "fromNow" } }] },
      { name: tr().presetAttention, filterMatch: "all", filters: [{ kind: "category", field: "attention", op: "is", values: [...ATTENTION] }] },
      // my work (only once this device's name is set)
      ...(me ? [{ name: tr().presetMyWork, filterMatch: "all" as const, filters: [open, { kind: "category" as const, field: "assignee" as const, op: "is" as const, values: [me] }] }] : []),
      // no start and no end → no bar
      { name: tr().presetNoDates, filterMatch: "all", filters: [
        { kind: "date", field: "start", op: "empty" },
        { kind: "date", field: "end", op: "empty" },
      ] },
      // no assignee
      { name: tr().presetUnassigned, filterMatch: "all", filters: [
        { kind: "category", field: "assignee", op: "empty", values: [] },
      ] },
      // status sits in the Completed group
      { name: tr().presetCompleted, filterMatch: "all", filters: [
        { kind: "category", field: "statusGroup", op: "is", values: ["completed"] },
      ] },
    ];
  }

  // apply a preset (replaces filters + match)
  private applyPreset(p: FilterPreset): void {
    const clone = JSON.parse(JSON.stringify(p)) as FilterPreset; // avoid sharing references
    this.filters = clone.filters;
    this.filterMatch = clone.filterMatch;
    if (clone.groupBy) {
      this.groupBy = clone.groupBy;
      this.saveBoard();
    }
    this.commitFilters();
  }

  // save the current filter config as a preset
  private savePreset(name: string): void {
    const s = this.plugin.settings;
    s.filterPresets.push({ name, filterMatch: this.filterMatch, filters: JSON.parse(JSON.stringify(this.filters)) as Filter[] });
    this.commitFilters();
    this.saveSoon(); // presets live in the plugin settings, not in the layout like a tab's filters
  }

  // presets popover
  private openPresetMenu(anchor: HTMLElement): void {
    const s = this.plugin.settings;
    openPopover(anchor, "ogantt-datemenu", (menu, close) => {
      menu.addClass("ogantt-presetmenu");
      const renderBody = () => {
        menu.empty();
        // built-in
        menu.createDiv({ cls: "ogantt-preset-heading", text: tr().presetBuiltinHeading });
        for (const p of this.builtinPresets()) {
          menu.createEl("button", { cls: "ogantt-preset-item", text: p.name }).onclick = () => { this.applyPreset(p); close(); };
        }
        // user presets (apply on click, trash to delete)
        if (s.filterPresets.length > 0) {
          menu.createDiv({ cls: "ogantt-preset-heading", text: tr().presetUserHeading });
          s.filterPresets.forEach((p, i) => {
            const item = menu.createDiv({ cls: "ogantt-preset-item ogantt-preset-user" });
            item.createEl("button", { cls: "ogantt-preset-apply", text: p.name }).onclick = () => { this.applyPreset(p); close(); };
            const del = item.createEl("button", { cls: "ogantt-preset-del", attr: { "aria-label": tr().presetDelete } });
            setIcon(del, "trash-2");
            del.onclick = () => { s.filterPresets.splice(i, 1); this.commitFilters(); this.saveSoon(); renderBody(); };
          });
        }
        // when filters exist: save form + clear
        if (this.filters.length > 0) {
          menu.createDiv({ cls: "ogantt-preset-sep" });
          const save = menu.createDiv({ cls: "ogantt-preset-save" });
          const input = save.createEl("input", { type: "text", cls: "ogantt-preset-name", attr: { "aria-label": tr().presetNamePlaceholder } });
          input.placeholder = tr().presetNamePlaceholder;
          const btn = save.createEl("button", { cls: "ogantt-preset-savebtn", text: tr().presetSave });
          const doSave = () => { const name = input.value.trim(); if (!name) { input.focus(); return; } this.savePreset(name); renderBody(); };
          btn.onclick = doSave;
          input.onkeydown = (e) => { if (e.key === "Enter" && !composing(e)) { e.preventDefault(); doSave(); } };
          const clear = menu.createEl("button", { cls: "ogantt-preset-item ogantt-preset-clear" });
          setIcon(clear.createSpan({ cls: "ogantt-preset-item-ico" }), "x");
          clear.createSpan({ text: tr().presetClear });
          clear.onclick = () => { this.filters = []; this.filterMatch = "all"; this.commitFilters(); close(); };
        }
      };
      renderBody();
    });
  }

  // editor popover for one filter
  private openFilterEditor(anchor: HTMLElement, index: number): void {
    const f = this.filters[index];
    if (!f) return;
    openPopover(anchor, "ogantt-datemenu", (menu, close) => {
      const commit = () => this.commitFilters();
      const renderBody = () => {
        menu.empty();
        // header: field name + remove
        const head = menu.createDiv({ cls: "ogantt-datemenu-head" });
        setIcon(head.createSpan({ cls: "ogantt-datemenu-field-ico" }), this.filterIcon(f));
        head.createSpan({ cls: "ogantt-datemenu-field", text: this.filterFieldLabel(f) });
        const del = head.createEl("button", { cls: "ogantt-datemenu-del clickable-icon" });
        setIcon(del, "trash-2");
        del.setAttr("aria-label", tr().dfRemove);
        del.onclick = () => { this.filters.splice(index, 1); commit(); close(); };

        if (f.kind === "category") this.renderCategoryEditor(menu, f, commit, renderBody);
        else if (f.kind === "text") this.renderTextEditor(menu, f, commit);
        else this.renderDateEditor(menu, f, commit, renderBody);
      };
      renderBody();
    });
  }

  // category editor body
  private renderCategoryEditor(menu: HTMLElement, f: CategoryFilter, commit: () => void, rebuild: () => void): void {
    const opRow = menu.createDiv({ cls: "ogantt-datemenu-val" });
    const opSel = opRow.createEl("select", { cls: "dropdown" });
    for (const op of ["is", "isNot", "empty", "notEmpty"] as CategoryOp[]) {
      const o = opSel.createEl("option", { text: this.catOpLabel(op), value: op });
      if (op === f.op) o.selected = true;
    }
    opSel.onchange = () => { f.op = opSel.value as CategoryOp; commit(); rebuild(); };
    // value checklist for is/isNot (OR within field)
    if (f.op === "is" || f.op === "isNot") {
      const listEl = menu.createDiv({ cls: "ogantt-datemenu-checklist" });
      const values = this.filterFieldValues(f.field);
      for (const [val, label] of values) {
        const item = listEl.createEl("label", { cls: "ogantt-datemenu-check" });
        const cb = item.createEl("input", { type: "checkbox" });
        // people compare by display name ("[[Ben]]" and "Ben" are one person, as in the filter)
        const same = (x: string): boolean => (f.field === "assignee" ? linkLabel(x) === linkLabel(val) : f.field === "tag" ? x.toLowerCase() === val.toLowerCase() : x === val);
        cb.checked = f.values.some(same);
        item.createSpan({ text: label });
        cb.onchange = () => {
          if (cb.checked) { if (!f.values.some(same)) f.values.push(val); }
          else f.values = f.values.filter((x) => !same(x));
          commit(); // no rebuild: checkbox keeps its own state
        };
      }
    }
  }

  // text (task name) editor body
  private renderTextEditor(menu: HTMLElement, f: TextFilter, commit: () => void): void {
    const opRow = menu.createDiv({ cls: "ogantt-datemenu-val" });
    const opSel = opRow.createEl("select", { cls: "dropdown" });
    for (const op of ["is", "isNot", "contains", "notContains", "startsWith", "endsWith"] as TextOp[]) {
      const o = opSel.createEl("option", { text: this.textOpLabel(op), value: op });
      if (op === f.op) o.selected = true;
    }
    opSel.onchange = () => { f.op = opSel.value as TextOp; commit(); };
    const body = menu.createDiv({ cls: "ogantt-datemenu-val" });
    const input = body.createEl("input", { type: "text", cls: "ogantt-datemenu-text", attr: { "aria-label": tr().fieldName } });
    input.value = f.value;
    // filter once typing pauses, not on every keystroke
    input.oninput = () => {
      f.value = input.value;
      if (this.filterTimer != null) window.clearTimeout(this.filterTimer);
      this.filterTimer = window.setTimeout(() => {
        this.filterTimer = null;
        commit();
      }, 150);
    };
  }

  // date editor body
  private renderDateEditor(menu: HTMLElement, f: DateFilterItem, commit: () => void, rebuild: () => void): void {
    const todayISO = dayToStr(this.today());
    // a mode (preset name or kind) → a default DateValue
    const valueForMode = (mode: string): DateValue => {
      switch (mode) {
        case "yesterday": case "today": case "tomorrow": return { kind: "preset", preset: mode };
        case "specific": return { kind: "specific", date: todayISO };
        case "relative": return { kind: "relative", amount: 1, unit: "day", dir: "fromNow" };
        case "range": return { kind: "range", from: todayISO, to: todayISO };
        default: return { kind: "preset", preset: "today" };
      }
    };
    const opRow = menu.createDiv({ cls: "ogantt-datemenu-val" });
    const opSel = opRow.createEl("select", { cls: "dropdown" });
    for (const op of ["is", "before", "after", "onOrBefore", "onOrAfter", "empty", "notEmpty"] as DateOp[]) {
      const o = opSel.createEl("option", { text: this.dateOpLabel(op), value: op });
      if (op === f.op) o.selected = true;
    }
    opSel.onchange = () => {
      const op = opSel.value as DateOp;
      f.op = op;
      if (op === "empty" || op === "notEmpty") f.value = undefined;
      else if (!f.value) f.value = valueForMode("today");
      else if (f.value.kind === "range" && op !== "is") f.value = valueForMode("today"); // range is "is"-only
      commit();
      rebuild();
    };
    if (f.op === "empty" || f.op === "notEmpty") return;

    const body = menu.createDiv({ cls: "ogantt-datemenu-val" });
    const modeSel = body.createEl("select", { cls: "dropdown" });
    const modes: [string, string][] = [
      ["today", tr().today], ["yesterday", tr().dfYesterday], ["tomorrow", tr().dfTomorrow],
      ["specific", tr().dfKindSpecific], ["relative", tr().dfKindRelative],
    ];
    if (f.op === "is") modes.push(["range", tr().dfKindRange]); // range only for "is"
    const curMode = !f.value ? "today" : f.value.kind === "preset" ? f.value.preset : f.value.kind;
    for (const [val, text] of modes) {
      const o = modeSel.createEl("option", { text, value: val });
      if (val === curMode) o.selected = true;
    }
    modeSel.onchange = () => { f.value = valueForMode(modeSel.value); commit(); rebuild(); };

    const v = f.value;
    if (v?.kind === "specific") {
      const inp = body.createEl("input", { type: "date" });
      inp.value = v.date;
      inp.onchange = () => { if (inp.value) { v.date = inp.value; commit(); } };
    } else if (v?.kind === "relative") {
      const num = body.createEl("input", { type: "number", cls: "ogantt-datemenu-num" });
      num.min = "1";
      num.value = String(v.amount);
      num.onchange = () => { const n = Math.max(1, Math.floor(+num.value || 1)); v.amount = n; num.value = String(n); commit(); };
      const unitSel = body.createEl("select", { cls: "dropdown" });
      for (const [u, text] of [["day", tr().dfDay], ["week", tr().dfWeek], ["month", tr().dfMonth]] as [DateUnit, string][]) {
        const o = unitSel.createEl("option", { text, value: u });
        if (u === v.unit) o.selected = true;
      }
      unitSel.onchange = () => { v.unit = unitSel.value as DateUnit; commit(); };
      const dirSel = body.createEl("select", { cls: "dropdown" });
      for (const [d, text] of [["fromNow", tr().dfFromNow], ["ago", tr().dfAgo]] as [DateDir, string][]) {
        const o = dirSel.createEl("option", { text, value: d });
        if (d === v.dir) o.selected = true;
      }
      dirSel.onchange = () => { v.dir = dirSel.value as DateDir; commit(); };
    } else if (v?.kind === "range") {
      const from = body.createEl("input", { type: "date" });
      from.value = v.from;
      from.onchange = () => { if (from.value) { v.from = from.value; commit(); } };
      body.createSpan({ cls: "ogantt-datemenu-sep", text: tr().dfRangeTo });
      const to = body.createEl("input", { type: "date" });
      to.value = v.to;
      to.onchange = () => { if (to.value) { v.to = to.value; commit(); } };
    }
  }

  // ----- toolbar -----
  private renderToolbar(root: HTMLElement): void {
    const bar = root.createDiv({ cls: "ogantt-toolbar" });
    // the folder name doubles as a board switcher
    const title = bar.createEl("button", { cls: "ogantt-title" }); // retitle() names it
    this.titleText = title.createSpan();
    setIcon(title.createSpan({ cls: "ogantt-title-caret" }), "chevron-down");
    title.onclick = () => {
      const folders = this.app.vault.getAllLoadedFiles().filter((f): f is TFolder => f instanceof TFolder).map((f) => (f.isRoot() ? "" : f.path)).sort();
      new PickModal(this.app, folders, (f) => f || tr().vaultRoot, tr().menuOpen, (folder) =>
        void this.leaf.setViewState({ type: VIEW_TYPE_GANTT, active: true, state: { ...this.getState(), folder } })).open();
    };
    // the layout switch (remembered per tab): planning on the Timeline, the daily scrum on the Board, people on Team
    this.layoutSeg = bar.createDiv({ cls: "ogantt-seg ogantt-layout", attr: { role: "group", "aria-label": tr().layoutAria } });
    for (const [l, icon, label] of [["timeline", "gantt-chart", tr().layoutTimeline], ["board", "kanban", tr().layoutBoard], ["team", "users", tr().layoutPeople]] as const) {
      const b = this.layoutSeg.createEl("button", { attr: { "data-layout": l } });
      setIcon(b.createSpan({ cls: "ogantt-opt-ico" }), icon);
      b.createSpan({ text: label });
      b.onclick = () => this.switchLayout(l);
    }
    this.useLayout(this.layout);
    // add a new task (icon + label)
    const add = bar.createEl("button", { cls: "ogantt-add mod-cta" }); // the one primary action
    setIcon(add, "plus");
    add.createSpan({ cls: "ogantt-add-label", text: tr().newTaskName });
    add.setAttr("aria-label", tr().newTaskAria);
    add.onclick = () => void this.createNewTask();
    // pick the kind (note / kanban / canvas) to create
    const kinds = bar.createEl("button", { cls: "ogantt-add-kind mod-cta", attr: { "aria-label": tr().newTaskKindAria } });
    setIcon(kinds, "chevron-down");
    kinds.onclick = () => {
      const m = new Menu();
      const label: Record<TaskKind, string> = { note: tr().kindNote, kanban: tr().kindKanban, canvas: tr().kindCanvas };
      for (const kind of ["note", "kanban", "canvas"] as TaskKind[]) {
        m.addItem((i) => i.setTitle(label[kind]).setIcon(KIND_ICON[kind]).onClick(() => void this.createNewTask(kind)));
      }
      // opened under the button (a keyboard press has its mouse position at 0,0)
      const r = kinds.getBoundingClientRect();
      m.showAtPosition({ x: r.left, y: r.bottom + 4 }, kinds.doc);
    };
    // scroll to today
    const todayBtn = bar.createEl("button", { cls: "ogantt-today-btn ogantt-quiet", text: tr().today });
    todayBtn.onclick = () => this.scrollToToday();
    // zoom as a segmented control (the pressed one is current)
    const zoomLabel: Record<ZoomMode, string> = { Day: tr().zoomDay, Week: tr().zoomWeek, Month: tr().zoomMonth, Fit: tr().zoomFit };
    const seg = bar.createDiv({ cls: "ogantt-seg ogantt-zoom", attr: { role: "group" } });
    for (const z of ["Day", "Week", "Month", "Fit"] as ZoomMode[]) {
      const btn = seg.createEl("button", { text: zoomLabel[z], attr: { "aria-pressed": String(z === this.zoom) } });
      btn.toggleClass("is-active", z === this.zoom);
      btn.onclick = () => {
        this.zoom = z; // ppd is set by computePpd() in rerender
        this.pad = { before: 0, after: 0 }; // drop the added days (rerender keeps the centre day in range)
        seg.querySelectorAll("button").forEach((b) => {
          b.toggleClass("is-active", b === btn);
          b.setAttr("aria-pressed", String(b === btn));
        });
        this.rerender(); // only the scale changed, so no disk read
      };
    }
    // undo and redo as one segmented group
    const history = bar.createDiv({ cls: "ogantt-seg ogantt-history", attr: { role: "group" } });
    // undo button
    const undo = history.createEl("button");
    setIcon(undo, "undo-2");
    undo.setAttr("aria-label", tr().undoAria);
    undo.onclick = () => void this.undo();
    this.undoBtn = undo;
    // redo button
    const redo = history.createEl("button");
    setIcon(redo, "redo-2");
    redo.setAttr("aria-label", tr().redoAria);
    redo.onclick = () => void this.redo();
    this.redoBtn = redo;
    this.updateUndoButton();

    // on the right: group by, colour by and the Display menu, built once since they don't depend on the data (so the Display menu's
    // anchor survives redraws). Occasional switches and the columns live in the Display menu; reload and PNG export in the "⋯" menu
    const host = bar.createDiv({ cls: "ogantt-options" });
    const display = host.createEl("button", { cls: "ogantt-opt-gear", attr: { "aria-haspopup": "true" } });
    setIcon(display.createSpan({ cls: "ogantt-opt-ico" }), "sliders-horizontal");
    display.createSpan({ text: tr().optDisplay });
    setIcon(display.createSpan({ cls: "ogantt-preset-caret" }), "chevron-down");
    display.onclick = () => this.openDisplayMenu(display);
  }

  // the view's "⋯" menu: export as PNG and reload (not frequent enough for the toolbar)
  onPaneMenu(menu: Menu, source: string): void {
    menu.addItem((i) => i.setTitle(`${tr().reportTitle}…`).setIcon("clipboard-list").onClick(() => this.openReport()));
    menu.addItem((i) => i.setTitle(tr().aiOpen).setIcon("sparkles").onClick(() => void this.plugin.openAi()));
    menu.addItem((i) => i.setTitle(tr().workPlanExport).setIcon("presentation").onClick(() => this.exportWorkPlan()));
    menu.addItem((i) => i.setTitle(tr().exportPng).setIcon("image-down").onClick(() => void this.exportPng()));
    menu.addItem((i) => i.setTitle(tr().reloadAria).setIcon("refresh-cw").onClick(() => void this.refresh()));
    super.onPaneMenu(menu, source);
  }

  // the Display menu: this board's display switches and the table's columns; built once, a switch only updates which items are available
  private openDisplayMenu(anchor: HTMLElement): void {
    openPopover(anchor, "ogantt-colmenu", (menu) => {
      const row = (label: string, checked: boolean, on: (v: boolean) => void): HTMLInputElement => {
        const item = menu.createEl("label", { cls: "ogantt-colmenu-item" });
        const cb = item.createEl("input", { type: "checkbox" });
        cb.checked = checked;
        item.createSpan({ text: label });
        cb.addEventListener("change", () => on(cb.checked));
        return cb;
      };
      // roll up and empty folders need folder grouping with Flat off; they stay, disabled, with the reason underneath
      const folderOnly: HTMLInputElement[] = [];
      let note: HTMLElement | null = null;
      const sync = () => {
        const off = this.groupBy !== "folder" || this.flat;
        folderOnly.forEach((cb) => (cb.disabled = off));
        note?.toggle(off);
      };
      const toggle = (key: "showDeps" | "showTags" | "progressLine" | "flat" | "rollup" | "showEmptyFolders", label: string) =>
        row(label, this[key], (v) => {
          this[key] = v;
          this.saveBoard();
          this.rerender();
          sync();
        });
      // grouping and colour (so the toolbar stays one row)
      const pick = (label: string, opts: [string, string][], value: string, on: (v: string) => void) => {
        const item = menu.createEl("label", { cls: "ogantt-colmenu-item ogantt-colmenu-pick" });
        item.createSpan({ text: label });
        const sel = item.createEl("select", { cls: "dropdown", attr: { "aria-label": label } });
        for (const [v, text] of opts) sel.createEl("option", { value: v, text });
        sel.value = value;
        sel.addEventListener("change", () => on(sel.value));
      };
      pick(tr().optGroupLabel, [["folder", tr().optGroupFolder], ["status", tr().fieldStatus], ["assignee", tr().fieldAssignee], ["tag", tr().fieldTags]], this.groupBy, (v) => {
        this.groupBy = v as GroupBy;
        this.saveBoard();
        this.rerender();
        sync();
      });
      pick(tr().optColorLabel, [["status", tr().fieldStatus], ["assignee", tr().fieldAssignee]], this.colorBy, (v) => {
        this.colorBy = v as typeof this.colorBy;
        this.saveBoard();
        this.rerender();
      });
      menu.createDiv({ cls: "ogantt-preset-heading", text: tr().optTimeline });
      toggle("showDeps", tr().optArrows);
      toggle("showTags", tr().optTagLabels);
      toggle("progressLine", tr().optProgressLine);
      menu.createDiv({ cls: "ogantt-preset-heading", text: tr().optRows });
      toggle("flat", tr().optFlat);
      folderOnly.push(toggle("rollup", tr().optRollup), toggle("showEmptyFolders", tr().optShowEmpty));
      note = menu.createDiv({ cls: "ogantt-colmenu-note", text: tr().folderOnly });
      sync();
      menu.createDiv({ cls: "ogantt-preset-heading", text: tr().optColumns });
      // columns: the shown ones in table order, the hidden ones dimmed below; the arrows reorder (keyboard too), and focus stays on the same control after a rebuild
      const cols = menu.createDiv();
      const paintCols = (focus?: string): void => {
        cols.empty();
        const s = this.plugin.settings;
        const list = columnList(this.columns(), s.visibleColumns ?? [], s.columnOrder ?? []);
        list.forEach(({ col, on }, i) => {
          const item = cols.createDiv({ cls: "ogantt-colmenu-col" + (on ? "" : " is-off") });
          const label = item.createEl("label", { cls: "ogantt-colmenu-item" });
          const cb = label.createEl("input", { type: "checkbox", attr: { "data-col": `${col.id}|0` } });
          cb.checked = on;
          label.createSpan({ text: col.label() });
          cb.addEventListener("change", () => {
            this.setColumnVisible(col.id, cb.checked);
            paintCols(`${col.id}|0`);
          });
          for (const dir of [-1, 1] as const) {
            const b = item.createEl("button", { cls: "clickable-icon", attr: { "data-col": `${col.id}|${dir}`, "aria-label": dir < 0 ? tr().colMoveUp(col.label()) : tr().colMoveDown(col.label()) } });
            setIcon(b, dir < 0 ? "arrow-up" : "arrow-down");
            b.disabled = list[i + dir]?.on !== on; // at an end, or at the shown/hidden boundary
            b.onclick = () => { if (this.shiftColumn(col.id, dir)) paintCols(`${col.id}|${dir}`); };
          }
        });
        // once a column reaches an end and its arrow is disabled, focus moves to the other arrow
        const el = focus ? cols.querySelector<HTMLInputElement | HTMLButtonElement>(`[data-col="${CSS.escape(focus)}"]`) : null;
        const box = el?.closest(".ogantt-colmenu-col");
        (el?.disabled ? box?.querySelector<HTMLElement>("button:not(:disabled)") ?? box?.querySelector("input") : el)?.focus();
      };
      paintCols();
      // view settings belong to this device (Vault Rooms doesn't sync .obsidian); editing a task changes its note, which is shared
      menu.createDiv({ cls: "ogantt-colmenu-note", text: tr().viewIsLocal });
    });
  }

  // the colour key's entries; both the on-screen legend and the exported PNG are built from them (a status opens its editor, a person their colour)
  private colorKey(): { color: string; label: string; edit?: (chip: HTMLElement) => void }[] {
    if (this.colorBy === "status") {
      return this.plugin.settings.statuses.map((s) => ({ color: s.color, label: s.label, edit: (chip: HTMLElement) => this.openStatusEditor(chip, s) }));
    }
    const none = this.tasks.some((t) => !t.assignees.length) ? [{ color: FALLBACK_BAR, label: tr().noneLabel }] : [];
    return [...this.assigneeList().map((a) => ({
      color: this.assigneeColor(a),
      label: linkLabel(a),
      // someone with a picked colour also gets "back to automatic"
      edit: (chip: HTMLElement) => pickColor(chip, this.assigneeColor(a), (c) => this.setColorOverride("assignee", linkLabel(a), c),
        this.plugin.settings.assigneeColors.some((c) => c.name === linkLabel(a)) ? () => this.setColorOverride("assignee", linkLabel(a), null) : undefined),
    })), ...none];
  }

  // the legend explaining the colours; with statuses, + adds one
  private renderLegend(): void {
    const legend = this.legendHost;
    legend.empty();
    // no legend while a table column already spells out what the colours mean (statuses can still be edited in settings);
    // the detail panel hiding the columns for a while doesn't toggle it, so the board never jumps up or down
    const said = this.visibleColumns(false).some((c) => c.id === this.colorBy);
    legend.toggleClass("is-hidden", said);
    if (said) return;
    for (const k of this.colorKey()) this.legendChip(legend, k.color, k.label, k.edit);
    if (this.colorBy !== "status") return;
    const add = legend.createEl("button", { cls: "ogantt-legend-chip ogantt-legend-add clickable-icon", attr: { "aria-label": tr().setAddStatus } });
    setIcon(add, "plus");
    add.onclick = () => this.openStatusEditor(add);
  }

  // a legend chip; a button when clickable, so the keyboard reaches it too
  private legendChip(parent: HTMLElement, color: string, label: string, onClick?: (chip: HTMLElement) => void): void {
    const chip = onClick ? parent.createEl("button", { cls: "ogantt-legend-chip" }) : parent.createDiv({ cls: "ogantt-legend-chip" });
    const sw = chip.createSpan({ cls: "ogantt-legend-swatch" });
    sw.style.background = color;
    chip.createSpan({ text: label });
    if (onClick) chip.onclick = () => onClick(chip);
  }

  // the board's assignees, deduplicated and sorted by display name (ties by the raw string, so the same spelling is always picked); built once per redraw
  private assigneeList(): string[] {
    const seen = new Set<string>();
    return (this.assigneeCache ??= [...new Set(this.tasks.flatMap((t) => t.assignees))]
      .map((a) => [linkLabel(a), a] as const)
      .sort(([la, a], [lb, b]) => la.localeCompare(lb) || (a < b ? -1 : a > b ? 1 : 0))
      .filter(([l]) => !seen.has(l) && !!seen.add(l)) // one entry per person (display name)
      .map(([, a]) => a));
  }

  // the status editor popover (name, colour, group, delete); without `st` it drafts a new one, added once it has a name
  private openStatusEditor(anchor: HTMLElement, st?: StatusDef): void {
    const s = this.plugin.settings;
    const draft: StatusDef = st ?? { ...newStatus(s.statuses, ""), id: "" };
    const persist = () => void this.plugin.saveLook();
    // a draft without a name isn't saved yet
    const save = () => { if (s.statuses.includes(draft)) persist(); };
    openPopover(anchor, "ogantt-statusmenu", (menu, close) => {
      const head = menu.createDiv({ cls: "ogantt-statusmenu-head" });
      const dot = head.createSpan({ cls: "ogantt-status-dot" });
      dot.style.background = draft.color;
      const name = head.createEl("input", { type: "text", attr: { placeholder: tr().setStatusLabel, "aria-label": tr().setStatusLabel } });
      name.value = draft.label;
      name.onkeydown = (e) => { if (e.key === "Enter" && !composing(e)) name.blur(); };
      name.onchange = () => {
        const v = name.value.trim();
        if (!v) { name.value = draft.label; return; }
        if (draft.id) this.plugin.renameStatusKeys(draft.label, v); // settings kept under the old name follow
        draft.label = v;
        if (!draft.id) {
          // a new id comes from the name, numbered to stay unique
          draft.id = newStatus(s.statuses, v).id;
          s.statuses.push(draft);
        }
        save();
      };
      paletteInto(menu, draft.color, (c) => {
        draft.color = c;
        dot.style.background = c;
        menu.querySelectorAll(".ogantt-swatch.is-active").forEach((el) => el.removeClass("is-active"));
        menu.querySelector(`.ogantt-swatch[aria-label="${c}"]`)?.addClass("is-active");
        save();
      });
      const foot = menu.createDiv({ cls: "ogantt-statusmenu-foot" });
      const group = foot.createEl("select", { cls: "dropdown", attr: { "aria-label": tr().setStatusGroup } });
      for (const g of STATUS_GROUPS) group.createEl("option", { value: g, text: statusGroupLabel(g) });
      group.value = draft.group;
      group.onchange = () => { draft.group = group.value as StatusGroup; save(); };
      if (st) {
        const del = foot.createEl("button", { cls: "clickable-icon", attr: { "aria-label": tr().setDeleteTooltip } });
        setIcon(del, "trash-2");
        del.onclick = () => {
          close();
          new ConfirmModal(this.app, {
            title: tr().setStatusesHeading,
            // statuses apply vault-wide, so notes outside this board count too
            body: tr().confirmDeleteStatus(st.label, this.app.vault.getMarkdownFiles().filter((f) => this.app.metadataCache.getFileCache(f)?.frontmatter?.[s.keys.status] === st.id).length),
            confirmText: tr().menuDelete,
            cancelText: tr().cancel,
            onConfirm: () => {
              const at = s.statuses.indexOf(st);
              if (at >= 0) s.statuses.splice(at, 1);
              renameAutoStatusId(this.plugin.settings.autoStatus, st.id, null);
              persist();
            },
          }).open();
        };
      }
      if (!st) window.setTimeout(() => name.focus(), 0);
    });
  }

  // tag/folder color (manual override, else auto from name)
  // the default colour reads a CSS variable, so it's kept per tag per redraw
  private tagColor(tag: string): string {
    let c = this.tagColorCache.get(tag);
    if (c === undefined) this.tagColorCache.set(tag, (c = resolveTagColor(this.plugin.settings.tagColors, this.plugin.settings.defaultTagColor, tag)));
    return c;
  }
  // a folder's colour: the one picked for it, else one no other folder on this board has (as people get), so projects tell apart;
  // red and orange are kept for warnings (overdue, urgent), so no project wears them unless picked
  private folderColor(name: string): string {
    const own = this.plugin.settings.folderColors;
    const picked = own.find((c) => c.name === name)?.color;
    if (picked) return picked;
    this.projectColors ??= distinctColors([...new Set(this.allFolders.flat())].filter((n) => !own.some((c) => c.name === n)), [...own.map((c) => c.color), "#ef4444", "#f97316"]);
    return this.projectColors.get(name) || hashColor(name);
  }
  // an assignee's colour (override by display name > an automatic colour no one else on the board has); someone not on the board yet (just added) gets the name hash
  private assigneeColor(who: string): string {
    const name = linkLabel(who);
    const own = this.plugin.settings.assigneeColors;
    const picked = own.find((c) => c.name === name)?.color;
    if (picked) return picked;
    if (!this.peopleColors) {
      // people with a picked colour take no automatic one, and picked colours aren't handed out
      const people = this.assigneeList().map(linkLabel);
      const mine = own.filter((c) => people.includes(c.name));
      this.peopleColors = distinctColors(people.filter((p) => !mine.some((c) => c.name === p)), mine.map((c) => c.color));
    }
    return this.peopleColors.get(name) || hashColor(name);
  }
  // paint a tag chip (border + faint bg + text)
  private paintTagChip(chip: HTMLElement, tag: string): void {
    const c = this.tagColor(tag);
    chip.style.borderColor = c;
    chip.style.color = c;
    chip.style.background = `color-mix(in srgb, ${c} 14%, transparent)`;
  }

  // set or clear a tag/folder/assignee color override (null = reset to auto)
  private setColorOverride(kind: "tag" | "folder" | "assignee", name: string, color: string | null): void {
    const s = this.plugin.settings;
    const arr = kind === "tag" ? s.tagColors : kind === "folder" ? s.folderColors : s.assigneeColors;
    const i = arr.findIndex((c) => (kind === "tag" ? c.name.toLowerCase() === name.toLowerCase() : c.name === name));
    // invariant: listed ⇔ has an explicit colour. A reset drops the entry outright, because a row with
    // no colour is indistinguishable from having no row at all and carries no information.
    if (color == null) {
      if (i >= 0) arr.splice(i, 1);
    } else if (i >= 0) {
      arr[i].color = color;
    } else {
      arr.push({ name, color });
    }
    void this.plugin.saveLook(); // reflected on every open board and in an open settings tab
  }

  // the right-click menu of a heading or tag chip: colour (folders, tags, assignees, statuses) from the palette, and the icon (headings only)
  // `heading` is a heading's icon key (headings only: a folder's path, else the name)
  private openStyleMenu(e: MouseEvent, axis: GroupBy, name: string, heading?: string): void {
    e.preventDefault();
    e.stopPropagation();
    const anchor = e.currentTarget as HTMLElement; // gone by the time an item is picked
    const s = this.plugin.settings;
    const status = axis === "status" ? s.statuses.find((x) => x.label === name) : undefined;
    const m = new Menu();
    if (axis !== "status" || status) {
      m.addItem((i) => i.setTitle(tr().menuChangeColor).setIcon("palette").onClick(() =>
        pickColor(anchor, this.groupColor(axis, name) ?? "", (c) => {
          if (axis !== "status") return this.setColorOverride(axis, name, c);
          status!.color = c;
          void this.plugin.saveLook();
        })
      ));
      // tags fall back to the default colour, folders and assignees to their name-derived one, so the labels differ (a status colour has no fallback)
      if (axis !== "status") {
        const reset = axis === "tag" ? tr().menuResetTagColor : tr().menuResetColor;
        m.addItem((i) => i.setTitle(reset).setIcon("rotate-ccw").onClick(() => this.setColorOverride(axis, name, null)));
      }
    }
    if (heading != null) {
      const key = `${axis}:${heading}`;
      // an icon that comes from the older folder-name key is shared with other folders, so it isn't deleted: this folder alone is set to none (empty)
      const legacy = this.legacyIcon(heading, name) != null;
      const setGroupIcon = (icon: string | null) => {
        if (icon) s.icons[key] = icon;
        else if (legacy) s.icons[key] = "";
        else delete s.icons[key];
        void this.plugin.saveLook();
      };
      m.addItem((i) => i.setTitle(tr().menuChangeIcon).setIcon("shapes").onClick(() => pickIcon(anchor, setGroupIcon)));
      if (s.icons[key] || legacy) m.addItem((i) => i.setTitle(tr().menuResetIcon).setIcon("rotate-ccw").onClick(() => setGroupIcon(null)));
    }
    m.showAtMouseEvent(e);
  }

  // a heading's colour (none for the "(none)" group)
  private groupColor(axis: GroupBy, name: string): string | undefined {
    if (axis !== "folder" && name === tr().noneLabel) return undefined;
    if (axis === "folder") return this.folderColor(name);
    if (axis === "tag") return this.tagColor(name);
    if (axis === "status") return this.plugin.settings.statuses.find((x) => x.label === name)?.color;
    const raw = this.assigneeList().find((a) => linkLabel(a) === name);
    return raw ? this.assigneeColor(raw) : undefined;
  }

  // a heading's icon key: for a folder its vault path rather than its name (A/Design and B/Design differ, and every board agrees)
  private headingKey(row: Row): string {
    if (this.groupBy !== "folder" || row.key == null) return row.group;
    return this.folder ? `${this.folder}/${row.key}` : row.key;
  }

  // a heading's icon (the user's pick > the axis default); folders also read the older name key
  private groupIcon(key: string, name: string, collapsed: boolean): string {
    const icons = this.plugin.settings.icons;
    const custom = icons[`${this.groupBy}:${key}`] ?? (this.groupBy === "folder" ? this.legacyIcon(key, name) : undefined);
    if (custom) return custom;
    if (this.groupBy === "folder") return collapsed ? "folder" : "folder-open";
    return this.groupBy === "tag" ? "tag" : this.groupBy === "assignee" ? "user" : "circle-dot";
  }

  // the icon under the older folder-name key ("folder:<name>"); only for a nested folder with no
  // key of its own, and only when no top-level folder has that name (if one does, the key is that folder's path key)
  private legacyIcon(path: string, name: string): string | undefined {
    const icons = this.plugin.settings.icons;
    if (path === name || `folder:${path}` in icons || this.app.vault.getAbstractFileByPath(name) instanceof TFolder) return undefined;
    return icons[`folder:${name}`];
  }

  // tasks after filter + group remap (logic lives in filter.ts)
  private processTasks(): Task[] {
    const { statuses } = this.plugin.settings;
    // evaluate `today` once and share it
    const list = applyFilters(this.tasks, this.filters, this.filterMatch, statuses, this.today());
    // the board and team don't use the rows' grouping (no copies per person or tag)
    if (this.layout !== "timeline") return list;
    // the Timeline folds finished work from before the window
    // too (the notes stay; the chip in the filter row shows them)
    const from = this.window()[0];
    const older = list.filter((t) => !isOpen(t, statuses) && boardWhen(t, true, from, Infinity) === "older");
    this.historyChip(older.length, from);
    return regroup(this.history ? list : list.filter((t) => !older.includes(t)), this.groupBy, this.flat, statuses, tr().noneLabel, this.tasks);
  }

  // scroll horizontally so the today marker is centered
  private scrollToToday(): void {
    // when today is outside the shown range, grow it first (not in Fit)
    const today = this.today();
    if (this.zoom !== "Fit" && this.boardMain) {
      const pad = padToCover(this.baseRange, this.pad, today, this.zoom); // room after today too (so the scroll isn't stopped at the end)
      if (pad.before !== this.pad.before || pad.after !== this.pad.after) {
        this.pad = pad;
        this.rerender();
      }
    }
    const main = this.boardMain;
    const todayLine = main?.querySelector<SVGElement>(".ogantt-today");
    if (!main || !todayLine) return; // no marker when today is out of range
    const mb = main.getBoundingClientRect();
    const tb = todayLine.getBoundingClientRect();
    // today a quarter of the way in (the other three quarters show what's coming)
    const tw = this.tableWidth();
    main.scrollLeft += tb.left - mb.left - tw - (main.clientWidth - tw) / 4;
  }

  // ----- every write goes through here: snapshot only the affected files, run fn, record the entry.
  // fn returns false for "nothing changed" (not recorded); report new files via `created` (trashed on undo)
  private async mutate(label: string, paths: string[], fn: () => Promise<MutateResult>): Promise<boolean> {
    if (this.refuseReadOnly(paths)) return false;
    return this.busy(new Set(paths).size, async () => {
      this.historyBusy++;
      let res: MutateResult = false;
      let files = new Map<string, string | null>();
      try {
        files = await this.snapshot(paths);
        res = await fn();
      } catch (e) {
        // a failure part-way leaves what was written, so record whatever changed and let undo put it back
        console.error(e);
        new Notice(tr().writeFailed);
        res = true;
      } finally {
        this.historyBusy--;
      }
      if (res === false) return false;
      const r = typeof res === "object" ? res : {};
      for (const p of r.created ?? []) files.set(p, null);
      // the contents after the op: with no move and nothing changed it isn't recorded (e.g. removing an inline-only #tag); undo checks they're still these
      // a moved file is read at its new path and kept under its old one (undo puts the moves back first, then checks the old paths)
      const at = (p: string) => (r.moves ?? []).reduce((q, m) => (q === m.from || q.startsWith(m.from + "/") ? m.to + q.slice(m.from.length) : q), p);
      const moved = await this.snapshot([...files.keys()].map(at));
      const post = new Map([...files.keys()].map((p) => [p, moved.get(at(p)) ?? null]));
      if (!r.moves?.length && !r.statuses?.length && [...files].every(([p, c]) => post.get(p) === c)) return false;
      this.record({ label, files, expect: post, moves: r.moves ?? [], created: r.created ?? [], deleted: r.deleted ?? [], statuses: r.statuses });
      return true;
    });
  }

  // show a "working" notice while an operation touches many files
  private async busy<T>(files: number, fn: () => Promise<T>): Promise<T> {
    const notice = files > BUSY_FILES ? new Notice(tr().workingOn(files), 0) : null;
    try {
      return await fn();
    } finally {
      notice?.hide();
    }
  }

  // record a new op (invalidates redo)
  private record(entry: HistoryEntry): void {
    this.dropUndoToast();
    this.pushHistory(this.undoStack, entry);
    this.redoStack = [];
    this.updateUndoButton();
  }

  // current contents of the given paths (null when missing)
  private async snapshot(paths: Iterable<string>): Promise<Map<string, string | null>> {
    const unique = [...new Set(paths)];
    // different files, so they're read in parallel
    const contents = await Promise.all(unique.map((p) => {
      const f = this.app.vault.getAbstractFileByPath(p);
      return f instanceof TFile ? this.app.vault.read(f) : null;
    }));
    return new Map(unique.map((p, i) => [p, contents[i]]));
  }

  // write a snapshot back: null trashes the file; a missing file is re-created only when it is in
  // `recreatable`, otherwise (e.g. deleted outside the board) it is left alone
  private async restore(files: Map<string, string | null>, recreatable: string[], current: Map<string, string | null>): Promise<void> {
    // different files, so they're written back in parallel; re-creations go afterwards one by one (so a folder is never created twice)
    const recreate: [string, string][] = [];
    await Promise.all([...files].map(async ([path, content]) => {
      const f = this.app.vault.getAbstractFileByPath(path);
      if (content === null) {
        if (!(f instanceof TFile)) return;
        await this.app.fileManager.trashFile(f);
        if (this.selectedPath === path) this.closeDetail();
      } else if (f instanceof TFile) {
        if (current.get(path) !== content) await this.app.vault.modify(f, content);
      } else if (!f && recreatable.includes(path)) recreate.push([path, content]);
    }));
    for (const [path, content] of recreate) {
      const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      if (dir && !this.app.vault.getAbstractFileByPath(dir)) await this.app.vault.createFolder(dir);
      await this.app.vault.create(path, content);
    }
  }

  // replay moves in order (files and folders alike; skip when the target is taken)
  private async replayMoves(moves: Move[]): Promise<void> {
    for (const m of moves) {
      const f = this.app.vault.getAbstractFileByPath(m.from);
      if (!f || this.app.vault.getAbstractFileByPath(m.to)) continue;
      await this.app.fileManager.renameFile(f, m.to);
      const sel = this.selectedPath;
      if (sel === m.from) this.selectedPath = m.to;
      else if (sel?.startsWith(m.from + "/")) this.selectedPath = m.to + sel.slice(m.from.length);
    }
  }

  private pushHistory(stack: HistoryEntry[], entry: HistoryEntry): void {
    stack.push(entry);
    if (stack.length > GanttView.UNDO_LIMIT) stack.shift();
  }

  // revert the latest op (undo moves → keep current contents for redo → restore the pre-op contents)
  // close the notice with the Undo button (after another change or an undo, its button would undo something else)
  private dropUndoToast(): void {
    this.undoToast?.hide();
    this.undoToast = null;
  }

  // shared by undo and redo. One at a time (overlapping runs from fast presses mix up the history). When a file no longer holds what it
  // should, it was changed outside, so nothing is overwritten and a notice offers to go ahead anyway (`force` skips the check).
  // the entry then stays where it was, so the next undo can't skip past it
  private async replay(redo: boolean, force = false): Promise<void> {
    if (this.isBusy()) return; // never undo in the middle of a write or a drag
    this.dropUndoToast();
    const stack = redo ? this.redoStack : this.undoStack;
    const entry = stack.pop();
    if (!entry) {
      new Notice(redo ? tr().nothingToRedo : tr().nothingToUndo);
      return;
    }
    this.historyRunning = true;
    this.historyBusy++;
    let conflict = false;
    try {
      await this.busy(entry.files.size + (entry.statuses?.length ?? 0), async () => {
        if (entry.statuses || entry.disable) {
          if (entry.statuses) await this.replayStatuses(entry.statuses, redo);
          if (entry.disable) this.setDisabled(entry.disable.paths, redo === entry.disable.on);
          this.pushHistory(redo ? this.undoStack : this.redoStack, entry);
          return;
        }
        if (!redo) await this.replayMoves(entry.moves.map((m) => ({ from: m.to, to: m.from })).reverse());
        const now = await this.snapshot(entry.files.keys());
        conflict = !force && [...(entry.expect ?? [])].some(([p, c]) => now.get(p) !== c);
        if (conflict) {
          if (!redo) await this.replayMoves(entry.moves); // put the moves back
          stack.push(entry);
          return;
        }
        // undo re-creates only what was deleted, redo only what was created
        await this.restore(entry.files, redo ? entry.created : entry.deleted, now);
        if (redo) await this.replayMoves(entry.moves);
        this.pushHistory(redo ? this.undoStack : this.redoStack, { ...entry, files: now, expect: entry.expect && entry.files });
      });
    } finally {
      this.historyBusy--;
      this.historyRunning = false;
    }
    if (conflict) {
      this.undoToast = this.buttonNotice(tr().changedSince(entry.label), redo ? tr().redoAnyway : tr().undoAnyway, () => void this.replay(redo, true), 10000);
    } else new Notice(redo ? tr().redone(entry.label) : tr().undone(entry.label));
    await this.refresh();
    if (this.selectedPath && this.detailEl.hasClass("is-open") && this.tasks.some((x) => x.path === this.selectedPath)) await this.openDetail(this.selectedPath);
    this.updateUndoButton();
  }

  private undo(): Promise<void> {
    return this.replay(false);
  }

  // redo an undone op (restore post-op contents → replay moves)
  private redo(): Promise<void> {
    return this.replay(true);
  }

  // record an outside rename (file explorer etc.) as an op of its own, so undo walks back in order and
  // older entries never see a path that no longer exists. Limited to this board's tasks (or folders
  // holding them) so unrelated renames, e.g. from sync, stay out of the history
  // a folder rename also fires for each file inside it, so batch the events
  // that arrive together and fold them into the folder's single move
  private queueOutsideRename(oldPath: string, newPath: string): void {
    this.pendingRenames.push({ from: oldPath, to: newPath });
    if (this.pendingRenames.length === 1) window.setTimeout(() => this.flushOutsideRenames(), 0);
  }

  private flushOutsideRenames(): void {
    const batch = this.pendingRenames;
    this.pendingRenames = [];
    for (const m of batch) {
      if (batch.some((o) => o !== m && movesUnder(o, m))) continue; // implied by a folder move
      const onBoard = this.tasks.some((t) => t.path === m.from || t.path.startsWith(m.from + "/"));
      if (!onBoard) continue;
      const name = (m.from.split("/").pop() ?? m.from).replace(/\.md$/, "");
      this.record({ label: tr().undoRename(name), files: new Map(), moves: [m], created: [], deleted: [] });
    }
  }

  // whether a rename is one of our own recorded moves (so a late event isn't recorded twice)
  private isOwnMove(oldPath: string, newPath: string): boolean {
    const tops = [this.undoStack[this.undoStack.length - 1], this.redoStack[this.redoStack.length - 1]];
    return tops.some((e) => e?.moves.some((m) =>
      movesUnder(m, { from: oldPath, to: newPath }) || movesUnder({ from: m.to, to: m.from }, { from: oldPath, to: newPath })));
  }

  // whether the detail panel is open on the given task
  private isDetailOpenFor(path: string): boolean {
    return !!this.detailEl?.hasClass("is-open") && this.selectedPath === path;
  }

  // rename a task (undoable); shared by the detail panel's title and the table's name cell
  private async renameTaskTo(from: string, oldName: string, newName: string): Promise<void> {
    if (this.refuseReadOnly([from])) return;
    let np: string | null = null;
    await this.mutate(tr().undoRename(oldName), [], async () => {
      const res = await renameTask(this.app, from, newName);
      if (res === "taken") new Notice(tr().nameTaken(newName.trim())); // a task of that name exists
      np = res === "taken" ? null : res;
      return np && np !== from ? { moves: [{ from, to: np }] } : false;
    });
    if (np && this.selectedPath === from) this.selectedPath = np;
    await this.refresh();
  }

  // rename in place in the table's name cell; row dragging is paused while editing so selecting text doesn't drag the row
  private renameInCell(nameText: HTMLElement, t: Task, row: HTMLElement): void {
    const draggable = row.getAttr("draggable");
    row.setAttr("draggable", "false");
    nameText.addClass("ogantt-name-editing");
    this.inlineInput(
      nameText,
      t.name,
      () => {
        nameText.removeClass("ogantt-name-editing");
        nameText.setText(t.name);
        if (draggable != null) row.setAttr("draggable", draggable);
      },
      (v) => this.renameTaskTo(t.path, t.name, v)
    );
  }

  // close the detail panel and clear the selection; returnFocus puts focus back on the row
  private closeDetail(returnFocus = false): void {
    const path = this.selectedPath;
    const at = this.barAt(path);
    this.selectedPath = null;
    this.askWhy = null;
    const was = this.detailEl?.hasClass("is-open");
    this.detailEl?.removeClass("is-open");
    if (was && !Platform.isPhone) {
      this.rerender(); // bring the hidden columns back
      if (path) this.holdBar(path, at, false);
    }
    if (this.bodyOwner) this.removeChild(this.bodyOwner);
    this.bodyOwner = null;
    this.markSelected(null);
    if (!returnFocus) return;
    // back to the row on the timeline, to the card in the card layouts
    if (this.layout === "timeline") this.focusRow(this.cursor);
    else if (path) this.boardMain?.querySelector<HTMLElement>(`.ogantt-kcard[data-path="${CSS.escape(path)}"]`)?.focus();
  }

  // mark the open task: its rows, bars and cards (copies included)
  private markSelected(path: string | null): void {
    const box = this.boardMain;
    box?.querySelectorAll(":is(.ogantt-tr, .ogantt-bar-g, .ogantt-kcard).is-selected").forEach((el) => el.removeClass("is-selected"));
    if (path) box?.querySelectorAll(`:is(.ogantt-tr, .ogantt-bar-g, .ogantt-kcard)[data-path="${CSS.escape(path)}"]`).forEach((el) => el.addClass("is-selected"));
  }

  // how far the open task's bar starts from the left edge of the box, table included (null without a bar)
  private barAt(path: string | null): number | null {
    const t = path ? this.tasks.find((x) => x.path === path) : undefined;
    const start = t ? anchorStart(t) ?? anchorEnd(t) : undefined;
    const main = this.boardMain;
    return start && main?.hasClass("ogantt-main") ? this.xOf(start) - main.scrollLeft + this.tableWidth() : null;
  }

  // opening or closing the detail panel leaves the open task's bar where it was on screen, at the same scale; with reveal, a bar (and its row)
  // that the panel would hide, or that is out of view, moves just far enough to show
  private holdBar(path: string, at: number | null, reveal: boolean): void {
    const main = this.boardMain;
    if (!main?.hasClass("ogantt-main") || Platform.isPhone) return;
    const t = this.tasks.find((x) => x.path === path);
    const start = t ? anchorStart(t) ?? anchorEnd(t) : undefined;
    if (t && start) {
      const x0 = this.xOf(start);
      const table = this.tableWidth();
      let left = at == null ? main.scrollLeft : x0 + table - at;
      if (reveal) left = revealSpan(left, main.clientWidth - table, x0, this.xOf(anchorEnd(t) ?? start) + this.ppd, REVEAL_PAD);
      main.scrollLeft = Math.max(0, left);
    }
    const i = reveal ? this.rows.findIndex((r) => r.task?.path === path) : -1;
    if (i >= 0) this.revealRow(main, i);
    this.scrollMemo = this.scrollOf(main);
    this.paintWindow?.();
  }

  // enable or disable the undo and redo buttons
  private updateUndoButton(): void {
    if (this.undoBtn) this.undoBtn.disabled = this.undoStack.length === 0;
    if (this.redoBtn) this.redoBtn.disabled = this.redoStack.length === 0;
  }

  // ----- table + timeline in one CSS grid; sticky heads/left column keep rows aligned. Only rows near the viewport become DOM -----
  private renderGrid(main: HTMLElement): void {
    const totalDays = this.range.max - this.range.min + 1;
    const width = totalDays * this.ppd;
    const bodyH = this.rows.length * ROW_H;
    const cols = this.visibleColumns();
    // column widths, worked out once per render
    const colWidth = new Map(cols.map((c) => [c.id, this.colW(c.id)]));
    const grid = main.createDiv({ cls: "ogantt-grid" });
    grid.style.gridTemplateColumns = `${this.tableWidth()}px ${width}px`;
    grid.style.gridTemplateRows = `${HEAD_H}px ${bodyH}px`;
    const tickZoom = this.tickZoom();
    this.fontFamily = getComputedStyle(this.contentEl).fontFamily; // for placing the tag pills
    this.renderHeader(grid, cols, colWidth, width);
    this.renderAxis(grid, tickZoom, width);

    const body = grid.createDiv({ cls: "ogantt-tbody", attr: { role: "tree", tabindex: "-1" } });
    this.tbodyEl = body;
    body.addEventListener("keydown", (e) => this.onRowKey(e));
    // the row that takes focus (via a chevron, a drag or a click) becomes the keyboard's row
    body.addEventListener("focusin", (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>(".ogantt-tr");
      if (row) this.cursor = Number(row.dataset.index);
    });

    const svgWrap = grid.createDiv({ cls: "ogantt-svgwrap" });
    // row lines and non-working days are a background, not elements
    const offDays = tickZoom === "Month" ? "" : offDayGradient(this.range.min, scheduleOptions(this.plugin.settings).cal, this.ppd, "var(--ogantt-offday)");
    const rowLines = `repeating-linear-gradient(to bottom, transparent 0 ${ROW_H - 1}px, var(--background-modifier-border) ${ROW_H - 1}px ${ROW_H}px)`;
    svgWrap.style.backgroundImage = [offDays, rowLines].filter((x) => x && x !== "none").join(", ");
    const svg = svgWrap.createSvg("svg", { cls: "ogantt-svg" });
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(bodyH));
    const layer = (cls: string) => svg.appendChild(this.svgEl("g", { class: cls }));
    const bgLayer = layer("ogantt-bg-layer");
    // the current sprint's dates get a faint wash (the same "now" as the Board and People)
    const sprint = this.currentSprint();
    if (sprint) svg.insertBefore(this.svgEl("rect", { x: this.dayX(sprint.from), y: 0, width: (sprint.to - sprint.from + 1) * this.ppd, height: bodyH, class: "ogantt-sprint-band" }), bgLayer);
    // a band following the hovered row across the timeline, so a name and its bar line up
    const band = svg.appendChild(this.svgEl("rect", { x: 0, y: -ROW_H, width, height: ROW_H, class: "ogantt-row-band" }));
    this.drawToday(svg, width, bodyH);
    const copyLayer = layer("ogantt-copy-layer");
    // dependency arrows sit below the bars, so a bar gets the click and hover where they overlap (arrowheads stop outside the bar's edge, so they stay visible)
    const depLayer = layer("ogantt-dep-layer");
    const barLayer = layer("ogantt-bar-layer");
    // the progress line goes above the bars (hidden, it would be useless)
    if (this.progressLine) this.drawProgressLine(svg, width, bodyH);
    // two connector handles in the topmost layer, shared by every bar; with arrows hidden, neither arrows nor handles are drawn
    const handles = this.showDeps ? this.makeHandles(svg, layer("ogantt-handles-layer")) : null;
    const depX = this.showDeps ? this.makeDepX(layer("ogantt-depx-layer")) : null;
    const fill = this.barFill(svg);
    const deps = this.showDeps ? this.depRows() : [];
    // with arrows hidden, a successor whose dependency is broken still gets a dashed outline, even when its predecessor is collapsed or filtered out
    this.conflicts = this.lateTasks();
    this.late = this.showDeps ? null : this.conflicts;

    // hovering a row or bar highlights every row, bar and copy of that task (copies come from grouping by assignee or tag)
    let hl: string | null = null;
    const highlight = (path: string | null) => {
      if (path === hl) return;
      grid.querySelectorAll(".is-hl").forEach((el) => el.removeClass("is-hl"));
      hl = path;
      if (path) grid.querySelectorAll(`[data-path="${CSS.escape(path)}"]`).forEach((el) => el.addClass("is-hl"));
    };
    grid.addEventListener("mouseover", (e) => highlight((e.target as Element).closest("[data-path]")?.getAttribute("data-path") ?? null));
    grid.addEventListener("mouseleave", () => highlight(null));
    grid.addEventListener("mousemove", (e) => {
      const tr = (e.target as Element).closest<HTMLElement>(".ogantt-tr");
      const i = tr ? Number(tr.dataset.index) : svgWrap.contains(e.target as Node) ? Math.floor((e.clientY - svg.getBoundingClientRect().top) / ROW_H) : -1;
      band.setAttribute("y", String(i * ROW_H));
    });
    grid.addEventListener("mouseleave", () => band.setAttribute("y", String(-ROW_H)));

    // draw only the rows in view (plus a margin); repaint once scrolling leaves that range
    let win = { first: -1, last: -1 };
    this.paintWindow = (force = false) => {
      this.clearTodayPill();
      const first = Math.floor(main.scrollTop / ROW_H);
      const last = Math.min(this.rows.length - 1, Math.ceil((main.scrollTop + main.clientHeight) / ROW_H));
      if (!force && first >= win.first && last <= win.last) return;
      // no repaint while a bar is held or a cell is being edited (removing the bar or the input would cut the drag or the typing short)
      const ae = activeDocument.activeElement;
      if (!force && (this.dragging === "bar" || (ae && body.contains(ae) && ae.matches("input, select, textarea")))) return;
      win = { first: Math.max(0, first - WINDOW_PAD), last: Math.min(this.rows.length - 1, last + WINDOW_PAD) };
      const hadFocus = body.contains(activeDocument.activeElement); // keep keyboard focus through the repaint
      this.hideCard();
      body.empty();
      bgLayer.empty();
      copyLayer.empty();
      barLayer.empty();
      depLayer.empty();
      this.drawCopyLinks(copyLayer, win.first, win.last);
      for (let i = win.first; i <= win.last; i++) {
        const row = this.rows[i];
        this.renderRow(body, row, i, cols, colWidth);
        if (row.kind === "group") this.drawGroupRow(bgLayer, barLayer, row, i, width);
        else this.drawBar(barLayer, svg, row, i, fill, handles);
      }
      for (const dep of deps) if (Math.max(dep.si, dep.pi) >= win.first && Math.min(dep.si, dep.pi) <= win.last) this.drawDep(depLayer, dep, depX);
      // when the keyboard's row isn't drawn, the first drawn row takes Tab
      if (this.cursor < win.first || this.cursor > win.last) {
        body.querySelector(`.ogantt-tr[data-index="${Math.min(first, win.last)}"]`)?.setAttribute("tabindex", "0");
        if (hadFocus) body.focus({ preventScroll: true }); // the row is gone but the keyboard stays in the table
      } else if (hadFocus) body.querySelector<HTMLElement>(`.ogantt-tr[data-index="${this.cursor}"]`)?.focus({ preventScroll: true });
      highlight(null);
    };
    // one scroll listener per scroll box (a grow keeps the box)
    if (main.dataset.scroll) return;
    main.dataset.scroll = "1";
    let ticking = false;
    let left = main.scrollLeft;
    main.addEventListener("scroll", () => {
      if (ticking) return;
      ticking = true;
      main.win.requestAnimationFrame(() => { // the view's own window (keeps running in a popout)
        ticking = false;
        if (main.clientHeight) this.scrollMemo = this.scrollOf(main);
        this.paintWindow?.();
        // a vertical-only scroll doesn't check the edges
        if (main.scrollLeft === left) return;
        left = main.scrollLeft;
        this.growNearEdge();
      });
    });
  }

  // when the horizontal scroll comes within one screen of an edge, add days on that side (keeping the same dates in view when adding on the left);
  // not in Fit, during a drag, while a cell is being edited, or during an export
  private growNearEdge(): void {
    const main = this.boardMain;
    if (!main?.clientWidth || this.zoom === "Fit" || this.dragging || this.exporting || this.extending) return;
    const ae = activeDocument.activeElement;
    if (ae && this.tbodyEl?.contains(ae) && ae.matches("input, select, textarea")) return;
    const margin = main.clientWidth;
    const side = nearEdge(main.scrollLeft, main.clientWidth, main.scrollWidth, margin);
    if (!side) return;
    // add enough in one go to leave the edge zone (no chain of redraws)
    const gap = side === "before" ? main.scrollLeft : main.scrollWidth - main.scrollLeft - main.clientWidth;
    const next = growPad(this.pad, side, this.zoom, Math.ceil((margin - gap) / this.ppd) + 1);
    if (!next) return;
    this.pad = next;
    this.extending = true;
    try {
      this.rerender(); // the redraw keeps the centre date, so adding on the left doesn't move the view
    } finally {
      this.extending = false;
    }
  }

  // the table header: visible columns, sort by click or Enter, width grip
  private renderHeader(grid: HTMLElement, cols: ColumnDef[], colWidth: Map<string, number>, width: number): void {
    const corner = grid.createDiv({ cls: "ogantt-corner" });
    const s = this.plugin.settings;
    // fold or unfold every heading (one line per project, in one click)
    const heads = this.rows.filter((r) => r.kind === "group" && r.key != null).map((r) => `${this.groupBy}:${r.key}`);
    if (heads.length) {
      const anyOpen = heads.some((k) => !this.collapsed.has(k));
      const all = corner.createEl("button", { cls: "clickable-icon ogantt-collapse-all", attr: { "aria-label": anyOpen ? tr().collapseAll : tr().expandAll } });
      setIcon(all, anyOpen ? "chevrons-down-up" : "chevrons-up-down");
      all.onclick = () => {
        if (anyOpen) heads.forEach((k) => this.collapsed.add(k));
        // unfolding includes nested headings that aren't on screen
        else for (const k of [...this.collapsed]) if (k.startsWith(`${this.groupBy}:`) && !k.endsWith(".md")) this.collapsed.delete(k);
        this.saveBoard();
        this.rerender();
        this.contentEl.querySelector<HTMLElement>(".ogantt-collapse-all")?.focus(); // keep the keyboard's place
      };
    }
    for (const col of cols) {
      const id = col.id;
      const sorted = s.sortBy === id;
      const th = corner.createDiv({
        cls: "ogantt-th ogantt-th-sortable" + (id === "name" ? " ogantt-th-name" : ""),
        attr: { role: "button", tabindex: "0", "data-col": id },
      });
      if (id !== "name") th.style.width = `${colWidth.get(id)}px`;
      th.createSpan({ text: col.label() });
      // show ↑/↓ on the active sort column
      if (sorted) th.createSpan({ cls: "ogantt-sort-arrow", text: s.sortDir === "asc" ? "↑" : "↓" });
      th.onclick = () => this.toggleSort(id);
      th.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this.toggleSort(id, true); } };
      // right-edge grip: drag to resize the column (persisted), quick double-press auto-fits to content
      const grip = th.createDiv({ cls: "ogantt-col-grip" });
      grip.addEventListener("click", (e) => e.stopPropagation()); // don't toggle sort
      let lastDown = 0;
      grip.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const nth = cols.indexOf(col) + 1;
        if (e.timeStamp - lastDown < 400) {
          // manual double-press detection (dblclick may be suppressed by preventDefault on pointerdown)
          lastDown = 0;
          this.autoFitColumn(id, th);
          return;
        }
        lastDown = e.timeStamp;
        grip.setPointerCapture(e.pointerId);
        this.dragging = "column";
        grip.addEventListener("lostpointercapture", () => { if (this.dragging === "column") this.dragging = null; }, { once: true });
        const startX = e.clientX;
        const startW = this.colW(id);
        let moved = false;
        const onMove = (ev: PointerEvent) => {
          moved = true;
          const w = Math.max(40, Math.round(startW + ev.clientX - startX));
          s.columnWidths[id] = w;
          // live-apply widths without a full re-render
          grid.style.gridTemplateColumns = `${this.tableWidth()}px ${width}px`;
          if (id !== "name") {
            th.style.width = `${w}px`;
            this.tbodyEl
              ?.querySelectorAll<HTMLElement>(`.ogantt-tr:not(.is-group) > .ogantt-td:nth-child(${nth})`)
              .forEach((el) => (el.style.width = `${w}px`));
          }
        };
        const onUp = () => {
          grip.removeEventListener("pointermove", onMove);
          // save only after an actual drag (a plain press doesn't re-render, keeping double-press alive)
          if (moved) void this.plugin.saveLook();
        };
        grip.addEventListener("pointermove", onMove);
        grip.addEventListener("pointerup", onUp, { once: true });
      });
    }
  }

  // the tick granularity (Fit picks it from the computed ppd)
  private tickZoom(): ZoomMode {
    return this.zoom !== "Fit" ? this.zoom : this.ppd >= 24 ? "Day" : this.ppd >= 10 ? "Week" : "Month";
  }

  // the axis ticks and the month (year in Month zoom) bands above, in the UI language's format
  private axisMarks(zoom: ZoomMode): { ticks: Tick[]; bands: Tick[] } {
    const fmt = dateFormat;
    const mo = fmt({ month: "short" });
    const wk = moment.weekdaysMin(); // the UI language's weekdays (Sunday first)
    // a week is named by its first day's number: the month band right above says which month, so it isn't repeated on every tick
    const label = (d: Date, z: ZoomMode) => (z === "Day" ? `${d.getUTCDate()} ${wk[d.getUTCDay()]}` : z === "Week" ? String(d.getUTCDate()) : mo.format(d));
    const band = zoom === "Month" ? fmt({ year: "numeric" }) : fmt({ year: "numeric", month: "long" });
    return { ticks: buildTicks(this.range, zoom, this.ppd, label, weekStart(scheduleOptions(this.plugin.settings).cal)), bands: buildBands(this.range, zoom, this.ppd, (d) => band.format(d)) };
  }

  // the Today pill shares the month row: a month name it would cover (stuck at the left edge, or starting just before today) moves to just
  // after it, or hides when its month has no room left there
  private clearTodayPill(): void {
    const pill = this.boardMain?.querySelector(".ogantt-today-pill");
    if (!pill) return;
    const names = Array.from(this.boardMain!.querySelectorAll<HTMLElement>(".ogantt-band span"));
    for (const s of names) {
      s.style.removeProperty("padding-left");
      s.style.removeProperty("visibility");
    }
    const p = pill.getBoundingClientRect();
    for (const s of names) {
      const r = s.getBoundingClientRect();
      if (r.right < p.left - 4 || r.left > p.right + 4) continue;
      const pad = p.right + 6 - r.left;
      if (r.left + pad + r.width <= s.parentElement!.getBoundingClientRect().right) s.style.paddingLeft = `${pad}px`;
      else s.style.visibility = "hidden";
    }
  }

  // the date axis
  private renderAxis(grid: HTMLElement, zoom: ZoomMode, width: number): void {
    const axis = grid.createDiv({ cls: "ogantt-axis" });
    const { ticks, bands } = this.axisMarks(zoom);
    for (const tick of ticks) {
      const t = axis.createDiv({ cls: "ogantt-tick" + (tick.major ? " is-major" : "") });
      t.style.left = `${tick.x}px`;
      t.setText(tick.label);
    }
    // each band is a box as wide as its month (a year in Month zoom); its name sticks to the timeline's left edge, so the month or year in view stays named
    const tw = this.tableWidth();
    bands.forEach((b, k) => {
      const box = axis.createDiv({ cls: "ogantt-band" });
      box.style.left = `${b.x}px`;
      box.style.width = `${(bands[k + 1]?.x ?? width) - b.x}px`;
      box.createSpan({ text: b.label }).style.left = `${tw}px`;
    });
    // the Today pill above the line, and the current sprint's span along the axis's foot (its name in the tooltip)
    const today = this.dayX(this.today());
    if (today >= 0 && today <= width) axis.createDiv({ cls: "ogantt-today-pill", text: tr().today }).style.left = `${today}px`;
    const sprint = this.currentSprint();
    if (sprint) {
      const span = axis.createDiv({ cls: "ogantt-sprint-span", attr: { title: sprint.task.name, "aria-label": sprint.task.name } });
      span.style.left = `${this.dayX(sprint.from)}px`;
      span.style.width = `${(sprint.to - sprint.from + 1) * this.ppd}px`;
    }
  }

  // one table row (a group heading or a task); only rows in view are built, so each is placed absolutely by its index
  private renderRow(body: HTMLElement, row: Row, i: number, cols: ColumnDef[], colWidth: Map<string, number>): void {
    const el = body.createDiv({ cls: "ogantt-tr", attr: { role: "treeitem", "aria-level": String(row.depth + 1), "data-index": String(i), tabindex: i === this.cursor ? "0" : "-1" } });
    el.style.top = `${i * ROW_H}px`;
    el.style.height = `${ROW_H}px`;
    const indent = this.indentOf(row);
    if (row.kind === "group") {
      el.addClass("is-group");
      const isCollapsed = this.isCollapsed(row.key);
      el.setAttr("aria-expanded", String(!isCollapsed));
      const g = el.createDiv({ cls: "ogantt-td-group" });
      g.style.paddingLeft = `${indent}px`;
      setIcon(g.createSpan({ cls: "ogantt-chevron", attr: { "aria-hidden": "true" } }), isCollapsed ? "chevron-right" : "chevron-down");
      const ic = g.createSpan({ cls: "ogantt-folder-icon", attr: { "aria-hidden": "true" } });
      // the axis icon (folder, tag, person, status) or the user's pick, tinted with the heading's colour ("(none)" stays plain)
      const none = this.groupBy !== "folder" && row.group === tr().noneLabel;
      setIcon(ic, none ? "circle-dashed" : this.groupIcon(this.headingKey(row), row.group, isCollapsed));
      const color = this.groupColor(this.groupBy, row.group);
      if (color) ic.style.color = color;
      g.createSpan({ cls: "ogantt-group-name", text: row.group });
      // open, overdue and urgent counts (grouped by assignee, each person's load and interruptions); disabled tasks and sprint notes don't count
      const { statuses } = this.plugin.settings;
      const today = this.today();
      const live = (row.tasks ?? []).filter((t) => !this.disabled.has(t.path) && isOpen(t, statuses) && !isSprint(t));
      // now: in progress (the started status; 0 without one) and blocked; next: the earliest task starting after today (so a section head reads "now" and "next" in one line)
      const [, running, blocked, late, hot] = openCounts(live, statuses, today, autoStatusTargets(statuses, this.plugin.settings.autoStatus).started);
      const sum = subtaskSummary((row.tasks ?? []).filter((t) => !this.disabled.has(t.path)), statuses);
      if (sum.total) g.createSpan({ cls: "ogantt-subtask-sum", text: `${sum.done}/${sum.total}`, attr: { title: tr().execComplete(sum.done, sum.total) } });
      // by assignee, two or more tasks under way at once is flagged too (switching cost)
      const juggling = this.groupBy === "assignee" && running > 1;
      // the heading shows only what needs attention (short enough not to be cut); the open and in-progress counts and what starts next are in the hover line
      const alerts = tr().headingAlerts(juggling ? running : 0, blocked, late, hot);
      if (alerts) g.createSpan({ cls: "ogantt-group-count is-alert", text: alerts });
      const next = nextToStart(live, today);
      // a subtask carries its parent, so a collapsed one can still be found
      const nextName = next ? (next.parent ? `${isolate(this.nameOf(next.parent))} › ` : "") + isolate(next.name) : "";
      g.setAttr("title", [row.group, sum.total ? `${sum.done}/${sum.total}` : "", live.length ? tr().headingCount(live.length, running, blocked, late, hot) : "", next ? tr().nextUp(nextName, formatDate(anchorStart(next)!, this.plugin.settings.dateFormat)) : ""].filter(Boolean).join(" · "));
      // right-click a heading to change its colour or icon (not "(none)")
      if (!none) g.addEventListener("contextmenu", (e) => this.openStyleMenu(e, this.groupBy, row.group, this.headingKey(row)));
      el.onclick = () => {
        this.focusRow(i);
        this.toggleCollapse(row.key);
      };
      // drop onto a folder = detach + move to its top level
      if (this.groupBy === "folder" && row.key != null) {
        const dest = this.folder ? `${this.folder}/${row.key}` : row.key;
        this.makeDropTarget(el, tr().dropMove(row.group), (src) => void this.reparentTo(src, dest, null));
      }
      // drop onto a tag or assignee group = add it (not "(none)")
      if ((this.groupBy === "tag" || this.groupBy === "assignee") && !none) {
        const field = this.groupBy === "tag" ? "tags" : "assignees";
        const value = field === "tags" ? row.group : this.assigneeList().find((a) => linkLabel(a) === row.group) ?? row.group;
        this.makeDropTarget(el, field === "tags" ? tr().dropTag(value) : tr().dropAssign(row.group), (src) => void this.editList(src, field, value, true));
      }
      return;
    }
    const t = row.task!;
    el.setAttr("data-path", t.path);
    if (row.hasChildren && row.key != null) el.setAttr("aria-expanded", String(!this.isCollapsed(row.key)));
    if (t.path === this.selectedPath) el.addClass("is-selected");
    if (this.disabled.has(t.path)) el.addClass("is-disabled");
    // parents in bold, nested subtasks joined by a guide line, finished ones subdued
    el.toggleClass("is-parent", !!row.hasChildren);
    el.toggleClass("is-sub", !!row.sub);
    el.toggleClass("is-done", !isOpen(t, this.plugin.settings.statuses));
    // render each visible column
    for (const col of cols) {
      if (col.kind !== "name") {
        const td = el.createDiv({ cls: "ogantt-td" });
        td.style.width = `${colWidth.get(col.id)}px`;
        this.renderCell(td, row, col);
        continue;
      }
      const nameTd = el.createDiv({ cls: "ogantt-td ogantt-td-name" });
      nameTd.style.paddingLeft = `${indent}px`;
      nameTd.style.setProperty("--ogantt-indent", `${indent}px`);
      // always reserve the chevron slot; for a parent it's the toggle button
      if (row.hasChildren && row.key != null) {
        const key = row.key;
        const open = !this.isCollapsed(key);
        const chev = nameTd.createEl("button", { cls: "ogantt-task-chevron is-clickable", attr: { "aria-label": open ? tr().collapse : tr().expand, "aria-expanded": String(open), tabindex: "-1" } });
        setIcon(chev, open ? "chevron-down" : "chevron-right");
        chev.addEventListener("click", (e) => {
          e.stopPropagation(); // don't open the detail panel
          this.toggleCollapse(key);
        });
      } else nameTd.createSpan({ cls: "ogantt-task-chevron" });
      const nameText = nameTd.createSpan({ cls: "ogantt-name-text", text: t.name });
      // markers for the kind (kanban, canvas) and for shared tasks (2+ assignees) trail the name, so names stay left-aligned
      if (t.kind === "canvas") setIcon(nameTd.createSpan({ cls: "ogantt-name-icon", attr: { "aria-label": tr().kindCanvas } }), KIND_ICON[t.kind]);
      if (t.assignees.length > 1) setIcon(nameTd.createSpan({ cls: "ogantt-name-icon", attr: { "aria-label": t.assignees.map(linkLabel).join(", ") } }), "users");
      if (this.readOnly(t.path)) {
        el.addClass("is-readonly");
        setIcon(nameTd.createSpan({ cls: "ogantt-name-icon", attr: { "aria-label": tr().readOnlyHint, title: tr().readOnlyHint } }), "lock");
      }
      // one tag for exceptions: the strongest as an icon and a word (never colour alone), plus "+N" when there are more; every reason is in the
      // details. A collapsed parent carries its subtasks' too. A row whose Status column already says blocked doesn't repeat it (it still counts)
      const { statuses } = this.plugin.settings;
      const excsOf = (x: Task) => this.exceptionsOf(x);
      // the summary and exceptions come from every subtask, filters aside (in screen order)
      // in flat view subtasks on screen speak for themselves (the parent carries only those filtered out)
      const kids = (this.kids.get(t.path) ?? []).filter((k) => !this.flat || !this.shown.has(k.path));
      const all = EXCEPTIONS.filter((e) => [...excsOf(t), ...(!row.hasChildren || this.isCollapsed(row.key) ? kids.flatMap(excsOf) : [])].includes(e));
      this.excTag(nameTd, all, statusGroupOf(statuses, t.status) === "deferred" && this.visibleColumns().some((c) => c.id === "status"));
      // the Gantt hierarchy (chevron and indent): a parent shows only how many subtasks are done; the rows are there on expanding
      this.subtaskPill(nameTd, kids);
      // the execution board (kanban) is a separate layer: no rows for its cards, just one cue that opens it
      if (t.kind === "kanban") this.boardCue(nameTd, t);
      // a double-click while the detail panel shows this task renames it in place; while the panel is closed
      // the first click just opens it (no accidental rename). The first click of a double-click re-opens the
      // panel too, so the check uses the state at the moment that first click went down
      let panelWasOpen = false;
      nameTd.addEventListener("mousedown", (e) => {
        if (e.detail === 1) panelWasOpen = this.isDetailOpenFor(t.path);
      });
      nameTd.addEventListener("dblclick", (e) => {
        if (!panelWasOpen) return;
        e.stopPropagation();
        this.renameInCell(nameText, t, el);
      });
      // clicks inside the input don't re-open the panel
      nameText.addEventListener("click", (e) => {
        if (nameText.querySelector("input")) e.stopPropagation();
      });
      // right-click the name (long-press on touch) for the row menu
      nameTd.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        this.openRowMenu(t, e);
      });
    }
    el.onclick = () => {
      this.focusRow(i);
      void this.openDetail(t.path);
    };
    if (this.groupBy === "folder") {
      this.makeDraggableTask(el, t.path);
      // drop onto a task = make it that task's subtask
      this.makeDropTarget(el, tr().dropSubtask(t.name), (src) => void this.reparentTo(src, this.taskFolder(t.path), t.path));
    } else if (this.groupBy === "tag" || this.groupBy === "assignee") {
      // when grouping by tag or assignee, drag onto a group to add it (no subtask drop)
      this.makeDraggableTask(el, t.path);
    }
  }

  // one exception tag: the strongest as an icon and a word (never colour alone), "+N" when there are more; every reason is in the details.
  // `said` = something else already says blocked (the Status column, the board's column), so it is neither shown nor counted
  private excTag(host: HTMLElement, all: Exception[], said: boolean, named = 1): void {
    const shown = all.filter((e) => !(e === "blocked" && said));
    if (!shown.length) return;
    const words = all.map((e) => EXC_TEXT[e]()).join(", ");
    const tag = host.createSpan({ cls: `ogantt-exc is-${shown[0]}`, attr: { title: words, "aria-label": words } });
    setIcon(tag.createSpan({ cls: "ogantt-exc-icon", attr: { "aria-hidden": "true" } }), EXC_ICON[shown[0]]);
    const rest = shown.length - named;
    tag.createSpan({ cls: "ogantt-exc-text", text: shown.slice(0, named).map((e) => EXC_TEXT[e]()).join(" · ") + (rest > 0 ? ` +${rest}` : "") });
  }

  // the nesting indent (capped), the same on screen and in the export
  private indentOf(row: Row): number {
    return 8 + Math.min(row.depth, MAX_INDENT_DEPTH) * 16;
  }

  // toggle a group or parent (display only; remembered per board)
  private toggleCollapse(key?: string): void {
    if (key == null) return;
    // parent tasks (keyed by note path) remember being open; headings remember being closed
    const set = key.endsWith(".md") ? this.expanded : this.collapsed;
    const k = key.endsWith(".md") ? key : `${this.groupBy}:${key}`;
    if (set.has(k)) set.delete(k);
    else set.add(k);
    this.saveBoard();
    this.rerender();
  }

  // whether a row is collapsed under the current grouping
  private isCollapsed(key?: string): boolean {
    if (key?.endsWith(".md")) return !this.expanded.has(key);
    return key != null && this.collapsed.has(`${this.groupBy}:${key}`);
  }

  // keyboard on table rows: ↑↓ Home End PageUp PageDown move, →← expand/collapse, Enter/Space open or toggle,
  // Shift+F10 or the menu key opens the row menu (F2 and Esc are view keys, handled by onF2 / onEscape)
  private onRowKey(e: KeyboardEvent): void {
    const el = e.target as HTMLElement;
    // leave inputs inside rows alone; on the table body itself (the keyboard's row is outside the drawn window) act as if on that row
    const onBody = el === this.tbodyEl;
    if (!onBody && !el.matches(".ogantt-tr")) return;
    const i = onBody ? this.cursor : Number(el.dataset.index);
    const row = this.rows[i];
    if (!row) return;
    const key = row.kind === "group" ? row.key : row.hasChildren ? row.key : undefined;
    const page = Math.max(1, Math.floor(((this.boardMain?.clientHeight ?? 0) - HEAD_H) / ROW_H) - 1);
    const go = (n: number) => { e.preventDefault(); this.focusRow(Math.max(0, Math.min(this.rows.length - 1, n))); };
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      return void this.moveRow(i, e.key === "ArrowUp" ? -1 : 1);
    }
    if (e.key === "ArrowDown") return go(i + 1);
    if (e.key === "ArrowUp") return go(i - 1);
    if (e.key === "Home") return go(0);
    if (e.key === "End") return go(this.rows.length - 1);
    if (e.key === "PageDown") return go(i + page);
    if (e.key === "PageUp") return go(i - page);
    if ((e.key === "ArrowRight" && key != null && this.isCollapsed(key)) || (e.key === "ArrowLeft" && key != null && !this.isCollapsed(key))) {
      e.preventDefault();
      return this.toggleCollapse(key);
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (row.kind === "group") return this.toggleCollapse(row.key);
      return void this.openDetail(row.task!.path);
    }
    if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
      e.preventDefault();
      if (row.kind === "task") return this.openRowMenu(row.task!, el);
      // a heading gets its right-click menu (colour, icon)
      const r = el.getBoundingClientRect();
      el.querySelector(".ogantt-td-group")?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + 24, clientY: r.bottom }));
    }
  }

  // move focus to a row, scrolling it into view (and drawing it) first
  // scroll vertically just enough for row i to show
  private revealRow(main: HTMLElement, i: number): void {
    const top = i * ROW_H;
    const view = main.clientHeight - HEAD_H;
    if (top < main.scrollTop) main.scrollTop = top;
    else if (top + ROW_H > main.scrollTop + view) main.scrollTop = top + ROW_H - view;
  }

  private focusRow(i: number): void {
    this.cursor = i;
    const main = this.boardMain;
    if (!main) return;
    this.revealRow(main, i);
    this.paintWindow?.();
    this.tbodyEl.querySelectorAll('.ogantt-tr[tabindex="0"]').forEach((el) => el.setAttr("tabindex", "-1"));
    const el = this.tbodyEl.querySelector<HTMLElement>(`.ogantt-tr[data-index="${i}"]`);
    el?.setAttr("tabindex", "0");
    el?.focus({ preventScroll: true });
  }

  // the row menu (open, make subtask, detach, move to folder, delete); also the alternative to drag and drop
  private openRowMenu(t: Task, at: MouseEvent | HTMLElement): void {
    const m = new Menu();
    m.addItem((i) => i.setTitle(tr().openAsNote).setIcon("external-link").onClick(() => this.openTask(t.path, "tab")));
    m.addItem((i) => i.setTitle(tr().menuMakeSubtask).setIcon("corner-down-right").onClick(() => {
      const banned = new Set(subtreePaths(this.tasks, t.path)); // no candidate that would make a cycle
      new PickModal(this.app, this.tasks.filter((x) => !banned.has(x.path)), (x) => this.taskLabel(x), tr().menuMakeSubtask, (p) =>
        void this.reparentTo(t.path, this.taskFolder(p.path), p.path)).open();
    }));
    if (t.parent) m.addItem((i) => i.setTitle(tr().menuDetach).setIcon("corner-left-up").onClick(() => void this.reparentTo(t.path, this.taskFolder(t.path), null)));
    m.addItem((i) => i.setTitle(tr().menuMoveToFolder).setIcon("folder-input").onClick(() => {
      const dirs = ["", ...this.allFolders.map((f) => f.join("/"))].map((rel) => (this.folder && rel ? `${this.folder}/${rel}` : this.folder || rel));
      new PickModal(this.app, dirs, (d) => d || tr().vaultRoot, tr().menuMoveToFolder, (d) => void this.reparentTo(t.path, d, null)).open();
    }));
    // up or down among its siblings (Alt+↑/↓ on the keyboard)
    // find the row when clicked (a sync may shift rows while the menu is open)
    const rowAt = () => (this.rows[this.cursor]?.task?.path === t.path ? this.cursor : this.rows.findIndex((r) => r.task?.path === t.path));
    if (this.layout === "timeline") {
      m.addItem((it) => it.setTitle(tr().menuMoveUp).setIcon("arrow-up").onClick(() => this.moveRow(rowAt(), -1)));
      m.addItem((it) => it.setTitle(tr().menuMoveDown).setIcon("arrow-down").onClick(() => this.moveRow(rowAt(), 1)));
    }
    const off = this.disabled.has(t.path);
    m.addItem((it) => it.setTitle(off ? tr().menuEnable : tr().menuDisable).setIcon(off ? "circle-play" : "circle-off").onClick(() =>
      this.setDisabled([t.path], !off, off ? tr().menuEnable : tr().menuDisable)));
    // urgent (interrupting) goes in the note's priority (undoable)
    const hot = isUrgent(t);
    m.addItem((it) => it.setTitle(hot ? tr().menuClearUrgent : tr().menuMarkUrgent).setIcon("zap").onClick(() => void this.setUrgent(t, !hot)));
    for (const target of this.resumable(t)) {
      m.addItem((it) => it.setTitle(tr().resumeTask(this.nameOf(target))).setIcon("play").onClick(() => void this.resume(target)));
    }
    m.addSeparator();
    m.addItem((i) => i.setTitle(tr().menuDelete).setIcon("trash-2").onClick(() => this.confirmDelete(t.path)));
    if ("clientX" in at) m.showAtMouseEvent(at); // instanceof fails across popout windows
    else {
      const r = at.getBoundingClientRect();
      m.showAtPosition({ x: r.left + 24, y: r.bottom }, at.doc);
    }
  }

  // a task's name in pickers, with its folder since names can repeat
  private taskLabel(t: Task): string {
    return t.groups.length ? `${t.name} — ${t.groups.join("/")}` : t.name;
  }

  private xOf(dateStr: string): number {
    return this.dayX(dayIndex(dateStr));
  }

  // a day index's x
  private dayX(day: number): number {
    return (day - this.range.min) * this.ppd;
  }

  // the width of a bar from `from` to `to`, both days included (at least 6 px, to stay grabbable)
  private spanW(from: string, to: string): number {
    return Math.max((dayIndex(to) - dayIndex(from) + 1) * this.ppd, 6);
  }

  // today marker
  private drawToday(svg: SVGElement, width: number, height: number): void {
    const x = this.dayX(this.today());
    if (x >= 0 && x <= width) svg.appendChild(this.svgEl("line", { x1: x, y1: 0, x2: x, y2: height, class: "ogantt-today" }));
  }

  // when one task shows on several rows (grouped by its assignees or tags), join its copies with a dotted line at the bar's start
  private drawCopyLinks(svg: SVGElement, first = 0, last = Infinity): void {
    const rowsOf = new Map<string, number[]>();
    this.rows.forEach((r, i) => { if (r.task) rowsOf.set(r.task.path, [...(rowsOf.get(r.task.path) ?? []), i]); });
    for (const [path, idx] of rowsOf) {
      if (idx[idx.length - 1] < first || idx[0] > last) continue; // outside the rows being drawn
      const start = idx.length > 1 ? anchorStart(this.rows[idx[0]].task!) : undefined;
      if (!start) continue;
      const x = this.xOf(start);
      const y = (i: number) => i * ROW_H + ROW_H / 2;
      svg.appendChild(this.svgEl("line", { x1: x, y1: y(idx[0]), x2: x, y2: y(idx[idx.length - 1]), class: "ogantt-copy-link", "data-path": path }));
    }
  }

  // a group row: its background and the summary bar of its span, in the heading's colour
  private drawGroupRow(bg: SVGElement, bars: SVGElement, row: Row, i: number, width: number): void {
    bg.appendChild(this.svgEl("rect", { x: 0, y: i * ROW_H, width, height: ROW_H, class: "ogantt-grid-group" }));
    if (!row.span) return;
    const gx = this.xOf(row.span.start);
    const gw = this.spanW(row.span.start, row.span.end);
    const gy = i * ROW_H + ROW_H / 2 - 3;
    const color = this.groupColor(this.groupBy, row.group);
    for (const el of [
      this.svgEl("rect", { x: gx, y: gy, width: gw, height: 6, rx: 2, class: "ogantt-group-bar" }),
      // end caps
      this.svgEl("path", { d: `M ${gx} ${gy} l 0 8 l 5 -8 z`, class: "ogantt-group-cap" }),
      this.svgEl("path", { d: `M ${gx + gw} ${gy} l 0 8 l -5 -8 z`, class: "ogantt-group-cap" }),
    ]) {
      if (color) el.style.fill = color;
      bars.appendChild(el);
    }
  }

  // progress line: joins each row's achieved-progress point against today; left = behind, right = ahead
  private drawProgressLine(svg: SVGElement, width: number, height: number): void {
    const basisX = this.dayX(this.today());
    if (basisX < 0 || basisX > width) return; // no basis to anchor to
    const lineRows: ProgressLineRow[] = this.rows.map((row) => {
      // group and rollup rows are summaries with no progress of their own, so they pass through
      if (row.kind === "group") return {};
      const t = row.task!;
      if (this.rollup && row.span) return {};
      const aStart = anchorStart(t);
      if (!aStart) return {};
      const x = this.xOf(aStart);
      if (!Number.isFinite(x)) return {}; // a bad date must not break the polyline
      if (t.milestone) return { startX: x, width: 0, progress: t.progress };
      const endStr = anchorEnd(t) ?? aStart;
      const w = this.spanW(aStart, endStr);
      return { startX: x, width: Number.isFinite(w) ? w : 0, progress: t.progress };
    });
    const pts = buildProgressLine(lineRows, basisX, ROW_H, height);
    const line = this.svgEl("polyline", {
      points: pts.map((p) => `${p.x},${p.y}`).join(" "),
      class: "ogantt-progress-line",
    });
    // color from settings; a stroke *attribute* loses to the CSS rule, so set it as an inline style
    // (leave it unset to fall back to the CSS default)
    const color = this.plugin.settings.progressLineColor;
    if (color) line.style.stroke = color;
    svg.appendChild(line);
  }

  // the bar fill: status or assignee colour, one band per person when shared
  private barFill(svg: SVGElement): (t: Task) => string {
    const statusColor = new Map(this.plugin.settings.statuses.map((x) => [x.id, x.color]));
    return (t) => {
      if (this.colorBy !== "assignee") return (t.status && statusColor.get(t.status)) || FALLBACK_BAR;
      if (t.assignees.length < 2) return t.assignees.length ? this.assigneeColor(t.assignees[0]) : FALLBACK_BAR;
      return this.bands(svg, t.assignees.map((a) => this.assigneeColor(a)));
    };
  }

  // one task's bar (rollup, milestone or regular). The status group also shows without colour: ✓ completed, hatching deferred, strike-through cancelled
  private drawBar(layer: SVGElement, svg: SVGElement, row: Row, i: number, fill: (t: Task) => string, handles: Handles | null): void {
    const t = row.task!;
    const group = statusGroupOf(this.plugin.settings.statuses, t.status);
    const cyMid = i * ROW_H + ROW_H / 2;
    const y = i * ROW_H + BAR_PAD;
    const h = ROW_H - BAR_PAD * 2;
    const open = (g: SVGGElement) => {
      // a click opens the panel (not right after a drag); hovering shows the card
      g.addEventListener("click", (ev) => {
        if (this.dragged.get(g)) return;
        ev.stopPropagation();
        void this.openDetail(t.path);
      });
      g.addEventListener("pointermove", (e) => this.moveCard(e));
      g.addEventListener("pointerleave", () => this.hideCard());
    };
    // rollup on: draw a parent as a full bar spanning its whole subtree (not its own bar)
    if (this.rollup && row.span) {
      const sx = this.xOf(row.span.start);
      const sw = this.spanW(row.span.start, row.span.end);
      const rg = this.svgEl("g", { class: "ogantt-bar-g ogantt-rollup-g" + (t.path === this.selectedPath ? " is-selected" : ""), "data-path": t.path });
      rg.appendChild(this.svgEl("rect", { x: sx, y, width: sw, height: h, rx: 4, class: "ogantt-bar ogantt-rollup-bar", fill: fill(t) }));
      this.drawLabel(rg, t, sx + sw + LABEL_GAP, cyMid, group, row.group);
      rg.addEventListener("pointerenter", (e) => this.showCard(t, e));
      open(rg);
      layer.appendChild(rg);
      return;
    }
    const aStart = anchorStart(t);
    if (!aStart) return;
    const x = this.xOf(aStart);
    const { statuses, autoStatus } = this.plugin.settings;
    const overdue = !this.disabled.has(t.path) && isOverdue(t, statuses, this.today());
    const flags = this.disabled.has(t.path) ? " is-disabled" : (this.late?.has(t.path) ? " is-late" : "") + (overdue ? " is-overdue" : "");
    // the kind follows the table's marks: hollow while waiting, solid once started, hatched when blocked, faded once done (not colour alone)
    const kind = statusKind(statuses.find((s) => s.id === t.status), autoStatusTargets(statuses, autoStatus).started);
    const color = fill(t);
    const g = this.svgEl("g", { class: `ogantt-bar-g is-${kind}${flags}${t.path === this.selectedPath ? " is-selected" : ""}`, "data-path": t.path });
    g.style.setProperty("--bar", color);
    let lx = x; // left handle x
    let rx = x; // right handle x
    if (t.milestone) {
      const r = h / 2;
      const dia = this.svgEl("path", {
        d: `M ${x} ${cyMid - r} L ${x + r} ${cyMid} L ${x} ${cyMid + r} L ${x - r} ${cyMid} Z`,
        class: "ogantt-milestone",
        fill: color,
      });
      g.appendChild(dia);
      this.attachDrag(g, dia, t);
      lx = x - r;
      rx = x + r;
    } else {
      const w = this.spanW(aStart, anchorEnd(t) ?? aStart);
      const rect = g.appendChild(this.svgEl("rect", { x, y, width: w, height: h, rx: 4, class: "ogantt-bar", fill: color }));
      const p = Math.min(100, t.progress ?? 0);
      const prog = p > 0 ? g.appendChild(this.svgEl("rect", { x, y, width: (w * p) / 100, height: h, rx: 4, class: "ogantt-bar-progress" })) : null;
      const hatch = group === "deferred" ? g.appendChild(this.svgEl("rect", { x, y, width: w, height: h, rx: 4, class: "ogantt-bar-hatch", fill: this.hatch(svg) })) : null;
      // while an edge is dragged, the progress fill and hatching follow the bar
      const place = (nx: number, nw: number) => {
        for (const r of [rect, hatch]) {
          r?.setAttribute("x", String(nx));
          r?.setAttribute("width", String(nw));
        }
        prog?.setAttribute("x", String(nx));
        prog?.setAttribute("width", String((nw * p) / 100));
      };
      this.attachDrag(g, rect, t, place);
      // ew-resize near edges, grab in the middle
      rect.addEventListener("mousemove", (e: MouseEvent) => {
        const box = rect.getBoundingClientRect();
        const off = e.clientX - box.left;
        const edge = Math.min(RESIZE_EDGE, box.width / 4);
        rect.style.cursor = off < edge || off > box.width - edge ? "ew-resize" : "grab";
      });
      rx = x + w;
    }
    // late work trails a red tail from its due date through today, so it shows while the view is at today
    const todayEnd = this.dayX(this.today() + 1);
    const tail = overdue && todayEnd > rx ? todayEnd : rx;
    if (tail > rx) g.appendChild(this.svgEl("rect", { x: rx, y: cyMid - 2, width: tail - rx, height: 4, rx: 2, class: "ogantt-late-tail" }));
    this.drawLabel(g, t, tail + LABEL_GAP, cyMid, group, row.group);
    g.addEventListener("pointerenter", (e) => {
      if (!this.readOnly(t.path)) handles?.show(t, g, lx, rx, cyMid);
      this.showCard(t, e);
    });
    g.addEventListener("pointerleave", (e) => { if (e.pointerType !== "touch") handles?.hide(); });
    open(g);
    layer.appendChild(g);
  }

  // the two connector handles (left = start, right = finish), shared by every bar and moved to the ends of the hovered one
  private makeHandles(svg: SVGElement, layer: SVGElement): Handles {
    const HGAP = 11; // gap from the bar edge
    let cur: { t: Task; g: SVGGElement } | null = null;
    // they linger briefly after the pointer leaves the bar, so it can reach a handle; once hidden they move off-canvas (never pressed unseen)
    let timer: number | null = null;
    const cancel = () => {
      if (timer != null) window.clearTimeout(timer);
      timer = null;
    };
    const ends = (["start", "finish"] as const).map((end) => {
      const handle = layer.appendChild(this.svgEl("circle", { r: 7, cx: -99, cy: -99, class: "ogantt-handle" }));
      handle.appendChild(this.svgEl("title", {})).textContent = tr().linkHint;
      handle.addEventListener("pointerdown", (e: PointerEvent) => { if (cur) this.startLink(cur.g, svg, cur.t, end, e); });
      handle.addEventListener("pointerenter", cancel);
      handle.addEventListener("pointerleave", () => api.hide());
      return { end, handle };
    });
    const api: Handles = {
      show: (t, g, lx, rx, cy) => {
        cancel();
        cur = { t, g };
        for (const { end, handle } of ends) {
          handle.setAttribute("cx", String(end === "start" ? lx - HGAP : rx + HGAP));
          handle.setAttribute("cy", String(cy));
          handle.classList.add("is-visible");
        }
      },
      hide: () => {
        cancel();
        timer = window.setTimeout(() => ends.forEach(({ handle }) => {
          handle.classList.remove("is-visible");
          handle.setAttribute("cx", "-99");
        }), 300);
      },
    };
    return api;
  }

  // to the right of a bar: assignee avatars (initials; overlapping for a shared task), the label (assignees; the task name is in the table on the left) and tag pills; ✓ marks
  // completed and ⚠ overdue. What the heading already says isn't repeated: grouped by assignee, the heading's person is left out and the others follow a "+";
  // grouped by tag, the heading's tag is left out. In an export the ✓ is drawn in the name column, so only people and tags follow the bar
  private drawLabel(g: SVGElement, t: Task, x: number, cy: number, group: StatusGroup | undefined, heading: string): void {
    // with the Assignee column in the table, neither initials nor names are repeated here
    const listed = !this.bare && this.visibleColumns().some((c) => c.id === "assignee");
    const people = listed ? [] : besideHeading(t.assignees, "assignees", this.groupBy, heading);
    const shown = people.slice(0, MAX_AVATARS);
    shown.forEach((a, k) => {
      const c = this.assigneeColor(a);
      const av = g.appendChild(this.svgEl("g", { class: "ogantt-bar-avatar" }));
      av.appendChild(this.svgEl("circle", { cx: x + 7 + k * 10, cy, r: 7, fill: c }));
      av.appendChild(this.svgEl("text", { x: x + 7 + k * 10, y: cy + 3, fill: inkOn(c) })).textContent = initials(linkLabel(a));
    });
    if (shown.length) x += 18 + (shown.length - 1) * 10;
    const others = people.length < t.assignees.length; // the heading's person was left out
    const who = people.map(linkLabel).join(", ");
    // only people follow the bar: done and overdue are said by the bar itself, and urgency by the Urgent tag on the row's name
    const text = who && others ? `+ ${who}` : who;
    if (text) g.appendChild(this.svgEl("text", { x, y: cy + 4, class: "ogantt-bar-label", "font-size": LABEL_PX })).textContent = text;
    // tags follow the label as small pills, quietly in their colour (hidden from the Display menu)
    // not repeated while the table has a Tags column
    if (!this.showTags || (!this.bare && this.visibleColumns().some((c) => c.id === "tags"))) return;
    const tags = besideHeading(t.tags, "tags", this.groupBy, heading);
    if (!tags.length) return;
    let px = text ? x + this.textWidth(text, LABEL_PX) + 8 : x;
    for (const tag of tags.slice(0, MAX_PILLS)) {
      const w = this.textWidth(tag, PILL_PX) + 12;
      const c = this.tagColor(tag);
      const pill = g.appendChild(this.svgEl("g", { class: "ogantt-tag-pill" }));
      pill.appendChild(this.svgEl("rect", { x: px, y: cy - 5, width: w, height: 14, rx: 7, fill: c, stroke: c }));
      pill.appendChild(this.svgEl("text", { x: px + w / 2, y: cy + 3, fill: c, "font-size": PILL_PX })).textContent = tag;
      px += w + 4;
    }
    if (tags.length > MAX_PILLS) g.appendChild(this.svgEl("text", { x: px, y: cy + 4, class: "ogantt-bar-label", "font-size": LABEL_PX })).textContent = `+${tags.length - MAX_PILLS}`;
  }

  // a string's width, measured on a canvas (no DOM layout)
  private textWidth(text: string, px: number, weight = 400): number {
    this.measureCtx.font = `${weight} ${px}px ${this.fontFamily}`;
    return this.measureCtx.measureText(text).width;
  }

  // set up a gradient of equal horizontal stripes and return its fill url (a shared task's assignee colours)
  private bands(svg: SVGElement, colors: string[]): string {
    const id = `ogantt-bands-${this.uid}-${colors.join("-").replace(/[^\w-]/g, "")}`;
    if (!svg.querySelector(`#${CSS.escape(id)}`)) {
      const grad = this.defs(svg).appendChild(this.svgEl("linearGradient", { id, x2: 0, y2: 1 }));
      colors.forEach((c, k) => {
        for (const at of [k, k + 1]) grad.appendChild(this.svgEl("stop", { offset: at / colors.length, "stop-color": c }));
      });
    }
    return `url(#${id})`;
  }

  // the hatching laid over a deferred bar
  private hatch(svg: SVGElement): string {
    const id = `ogantt-hatch-${this.uid}`;
    if (!svg.querySelector(`#${id}`)) {
      const p = this.defs(svg).appendChild(this.svgEl("pattern", { id, width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }));
      p.appendChild(this.svgEl("rect", { width: 2.5, height: 6, class: "ogantt-hatch-line" }));
    }
    return `url(#${id})`;
  }

  private defs(svg: SVGElement): SVGDefsElement {
    return svg.querySelector("defs") ?? svg.insertBefore(this.svgEl("defs", {}), svg.firstChild);
  }

  // drag from a handle to another task = create dependency
  private startLink(g: SVGGElement, svg: SVGElement, source: Task, sourceEnd: "start" | "finish", ev: PointerEvent): void {
    ev.preventDefault();
    ev.stopPropagation();
    this.hideCard();
    this.dragged.set(g, true); // suppress the bar click
    const handle = ev.target as Element;
    handle.setPointerCapture(ev.pointerId);
    this.dragging = "link";
    handle.addEventListener("lostpointercapture", () => { if (this.dragging === "link") this.dragging = null; }, { once: true });
    // measure the svg each time, so scrolling mid-drag still hits the right row
    const box = () => svg.getBoundingClientRect();
    const x1 = ev.clientX - box().left;
    const y1 = ev.clientY - box().top;
    const tmp = this.svgEl("path", { d: `M ${x1} ${y1} L ${x1} ${y1}`, class: "ogantt-link-temp" });
    svg.appendChild(tmp);

    const clearHi = () =>
      svg.querySelectorAll(".is-link-target").forEach((el) => el.removeClass("is-link-target"));
    const onMove = (e: PointerEvent) => {
      const x2 = e.clientX - box().left;
      const y2 = e.clientY - box().top;
      tmp.setAttribute("d", `M ${x1} ${y1} C ${x1 + 30} ${y1}, ${x2 - 30} ${y2}, ${x2} ${y2}`);
      clearHi();
      const row = this.rows[Math.floor(y2 / ROW_H)];
      if (row?.kind === "task" && row.task && row.task.path !== source.path) {
        svg
          .querySelector(`.ogantt-bar-g[data-path="${CSS.escape(row.task.path)}"] .ogantt-bar, .ogantt-bar-g[data-path="${CSS.escape(row.task.path)}"] .ogantt-milestone`)
          ?.addClass("is-link-target");
      }
    };
    const onUp = (e: PointerEvent) => void (async () => {
      handle.releasePointerCapture(ev.pointerId);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      tmp.remove();
      clearHi();
      this.dragging = null;
      // clear the click-suppress flag after the click fires
      window.setTimeout(() => this.dragged.set(g, false), 0);
      const row = this.rows[Math.floor((e.clientY - box().top) / ROW_H)];
      if (row?.kind !== "task" || !row.task || row.task.path === source.path) return;
      const target = row.task;
      if (!anchorStart(target) && !anchorEnd(target)) return; // a task without dates can't take a link
      // which end was dropped on
      const tLeft = this.xOf(anchorStart(target) ?? anchorEnd(target)!);
      const tRight = this.xOf(anchorEnd(target) ?? anchorStart(target)!) + this.ppd;
      const targetEnd: "start" | "finish" = e.clientX - box().left < (tLeft + tRight) / 2 ? "start" : "finish";
      // pick the type from the connected ends (predecessor = drag source, successor = drop target; SF is unsupported)
      const type: DepType | null =
        sourceEnd === "finish" ? (targetEnd === "start" ? "FS" : "FF") : targetEnd === "start" ? "SS" : null;
      if (type == null) new Notice(tr().sfUnsupported);
      else await this.addDep(source.path, target.path, type);
    })();
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      tmp.remove();
      clearHi();
    }, { once: true });
  }

  // add a dependency and cascade its successors (undoable); used by the drag and by the panel's "Add" alike
  private async addDep(predPath: string, succPath: string, type: DepType): Promise<void> {
    // rows may hold grouping copies; add the dep to the live task
    const target = this.tasks.find((x) => x.path === succPath);
    if (!target) return;
    // a dependency that would close a loop is refused (the cascade would have no answer)
    if (wouldLoop(this.tasks, predPath, succPath)) return void new Notice(tr().depLoop);
    // the cascade can reach target plus the successors of both ends
    const fs = this.plugin.settings.autoScheduleFS;
    const paths = [succPath, ...successorClosure(this.tasks, predPath, fs), ...successorClosure(this.tasks, succPath, fs)];
    await this.mutate(tr().undoAddDep(type), paths, async () => {
      await addDependency(this.app, this.plugin.settings, succPath, predPath, type);
      // reflect the dep in memory (aligns before the metadata cache updates)
      target.deps = target.deps.filter((d) => d.path !== predPath);
      target.deps.push({ path: predPath, type });
      await this.cascade([predPath]);
    });
    this.rerender();
  }

  // remove a dependency (undoable); it goes at once, so a notice offers an Undo button
  private async removeDep(succPath: string, predPath: string, type: DepType): Promise<void> {
    const ok = await this.mutate(tr().undoRemoveDep(type), [succPath], () => removeDependency(this.app, this.plugin.settings, succPath, predPath));
    // record() already closed the previous notice
    if (ok) this.undoToast = this.buttonNotice(tr().depRemoved(type), tr().undoShort, () => void this.undo(), 6000);
    await this.refresh();
  }

  // a notice with a button (Undo, Open)
  private buttonNotice(message: string, button: string, onClick: () => void, ms: number): Notice {
    return new Notice(createFragment((f) => {
      f.appendText(`${message} `);
      f.createEl("button", { text: button }).onclick = onClick;
    }), ms);
  }

  // propagate the roots' date changes to their successors (SS/FF snap, FS pushes when enabled; durations kept in
  // workdays). Writes to disk and updates the in-memory tasks; call it from inside mutate
  private async cascade(roots: string[]): Promise<void> {
    const changes = cascadeDates(this.cascadeTasks(), roots, scheduleOptions(this.plugin.settings));
    // dependencies in a loop have no answer: successors stay put, and we say why
    if (!changes) return void new Notice(tr().depLoop);
    // each change is a different file, so they're written in parallel; if one fails the rest still finish first, so the undo record matches what was written
    const results = await Promise.allSettled([...changes].map(async ([path, d]) => {
      const t = this.tasks.find((x) => x.path === path);
      if (!t) return;
      await writeDates(this.app, this.plugin.settings, path, d.start, d.end, false);
      t.start = d.start;
      t.end = d.end;
    }));
    const failed = results.find((x): x is PromiseRejectedResult => x.status === "rejected");
    if (failed) throw failed.reason;
  }

  // write dates and cascade (backs BoardContext.reschedule)
  private async reschedule(path: string, next: { start: string; end: string }, times: { start?: string; end?: string } = {}): Promise<string> {
    const t = this.tasks.find((x) => x.path === path);
    if (!t) return next.end;
    const k = this.plugin.settings.keys;
    const tz = this.plugin.settings.tz;
    const end = keepDurationOnStartChange(t, next, scheduleOptions(this.plugin.settings).cal);
    await this.mutate(tr().undoReschedule(t.name), [path, ...this.cascadePaths(path)], async () => {
      await writeField(this.app, path, k.start, combineDateTime(next.start || undefined, times.start, tz));
      // a task with no due date gets none when it's moved and stays a single day
      if (!(t.endFilled && end === next.start)) await writeField(this.app, path, k.end, combineDateTime(end || undefined, times.end, tz));
      // mirror in memory for the cascade (due only = milestone)
      t.start = next.start || undefined;
      t.end = end || undefined;
      if (!t.start && t.end) t.milestone = true;
      await this.cascade([path]);
    });
    await this.refresh();
    return end;
  }

  // successors a date change may move (undo snapshot targets)
  private cascadePaths(root: string): string[] {
    return successorClosure(this.cascadeTasks(), root, this.plugin.settings.autoScheduleFS);
  }

  // the tasks a cascade sees: a disabled task is never pushed (treated as having no dependencies, so the push doesn't pass through it)
  private cascadeTasks(): Task[] {
    return this.disabled.size ? this.tasks.map((t) => (this.disabled.has(t.path) ? { ...t, deps: [] } : t)) : this.tasks;
  }

  // the dependencies to draw, with the rows of both ends; each paint keeps those crossing the rows in view
  // grouped by assignee or tag a task shows in several rows, so each successor row gets an arrow from the nearest predecessor row
  private depRows(): DepRow[] {
    const rowsOf = new Map<string, number[]>();
    this.rows.forEach((r, i) => {
      if (r.kind !== "task") return;
      const list = rowsOf.get(r.task!.path);
      if (list) list.push(i);
      else rowsOf.set(r.task!.path, [i]);
    });
    const byPath = new Map(this.tasks.map((x) => [x.path, x]));
    const out: DepRow[] = [];
    for (const t of this.tasks) {
      for (const si of rowsOf.get(t.path) ?? []) {
        for (const dep of t.deps) {
          const pred = byPath.get(dep.path);
          const pis = rowsOf.get(dep.path);
          if (!pred || !pis) continue;
          const pi = pis.reduce((a, b) => (Math.abs(b - si) < Math.abs(a - si) ? b : a));
          out.push({ t, pred, type: dep.type, si, pi });
        }
      }
    }
    return out;
  }

  // one dependency arrow; hovering it brings the shared × (on top of everything) to its midpoint, and only the × removes it
  private drawDep(layer: SVGElement, dep: DepRow, depX?: DepX | null): void {
    const { t, pred, type: depType, si, pi } = dep;
    const sStart = anchorStart(t);
    const sEnd = anchorEnd(t);
    const pStartD = anchorStart(pred);
    const pEndD = anchorEnd(pred);
    if (!sStart || !sEnd || !pStartD || !pEndD) return;
    const GAP = 12;
    // a milestone's arrows stop at its tips (at the centre the arrowhead hides under the diamond)
    const tip = (ROW_H - BAR_PAD * 2) / 2;
    const sLeft = this.xOf(sStart) - (t.milestone ? tip : 0);
    const sRight = this.xOf(sEnd) + (t.milestone ? tip : this.ppd);
    const sy = si * ROW_H + ROW_H / 2;
    const pLeft = this.xOf(pStartD) - (pred.milestone ? tip : 0);
    const pRight = this.xOf(pEndD) + (pred.milestone ? tip : this.ppd);
    const py = pi * ROW_H + ROW_H / 2;
    const mid = (py + sy) / 2;
    let d: string;
    let mxX: number;
    const mxY = mid;
    let arrowD: string;
    const violation = depViolated(t, pred, depType, scheduleOptions(this.plugin.settings).cal);
    if (depType === "FS") {
      // pred finish → succ start
      const sx0 = pRight;
      const tx = sLeft;
      if (tx - sx0 > GAP * 2) {
        const mx = sx0 + Math.max(GAP, (tx - sx0) / 2);
        d = `M ${sx0} ${py} L ${mx} ${py} L ${mx} ${sy} L ${tx} ${sy}`;
        mxX = mx;
      } else {
        const ax = sx0 + GAP;
        const bx = tx - GAP;
        d = `M ${sx0} ${py} L ${ax} ${py} L ${ax} ${mid} L ${bx} ${mid} L ${bx} ${sy} L ${tx} ${sy}`;
        mxX = (ax + bx) / 2;
      }
      arrowD = `M ${tx} ${sy} l -7 -4 l 0 8 z`; // points right
    } else if (depType === "SS") {
      // pred start → succ start
      const sx0 = pLeft;
      const tx = sLeft;
      const leftMost = Math.min(sx0, tx) - GAP;
      d = `M ${sx0} ${py} L ${leftMost} ${py} L ${leftMost} ${sy} L ${tx} ${sy}`;
      mxX = leftMost;
      arrowD = `M ${tx} ${sy} l -7 -4 l 0 8 z`; // points right
    } else {
      // FF: pred finish → succ finish
      const sx0 = pRight;
      const tx = sRight;
      const rightMost = Math.max(sx0, tx) + GAP;
      d = `M ${sx0} ${py} L ${rightMost} ${py} L ${rightMost} ${sy} L ${tx} ${sy}`;
      mxX = rightMost;
      arrowD = `M ${tx} ${sy} l 7 -4 l 0 8 z`; // points left
    }
    const depG = this.svgEl("g", { class: "ogantt-dep-g" });
    const hit = depG.appendChild(this.svgEl("path", { d, class: "ogantt-dep-hit" }));
    hit.appendChild(this.svgEl("title", {})).textContent = tr().depTooltip(depType);
    depG.appendChild(this.svgEl("path", { d, class: "ogantt-dep" + (violation ? " is-violation" : "") }));
    depG.appendChild(this.svgEl("path", { d: arrowD, class: "ogantt-dep-arrow" + (violation ? " is-violation" : "") }));
    // show a type label for non-FS
    if (depType !== "FS") {
      const lbl = depG.appendChild(this.svgEl("text", { x: mxX, y: mxY - 9, class: "ogantt-dep-type" }));
      lbl.textContent = depType;
    }
    if (depX) {
      depG.addEventListener("pointerenter", () => depX(dep, mxX, mxY));
      depG.addEventListener("pointerleave", () => depX(null));
    }
    layer.appendChild(depG);
  }

  // the × that removes a dependency: one per board, on top of everything, moved to the
  // midpoint of the arrow under the pointer (so no bar can cover it); it lingers briefly after the pointer leaves, long enough to reach it
  private makeDepX(layer: SVGElement): DepX {
    let cur: DepRow | null = null;
    let timer: number | null = null;
    const xg = layer.appendChild(this.svgEl("g", { class: "ogantt-dep-x", role: "button" }));
    const ring = xg.appendChild(this.svgEl("circle", { r: 8, class: "ogantt-dep-x-bg" }));
    const mark = xg.appendChild(this.svgEl("path", { class: "ogantt-dep-x-mark" }));
    const stop = () => {
      if (timer != null) window.clearTimeout(timer);
      timer = null;
    };
    const hide = () => {
      stop();
      timer = window.setTimeout(() => xg.classList.remove("is-visible"), 300);
    };
    xg.addEventListener("pointerenter", stop);
    xg.addEventListener("pointerleave", hide);
    xg.addEventListener("click", (e) => {
      e.stopPropagation();
      xg.classList.remove("is-visible");
      if (cur) void this.removeDep(cur.t.path, cur.pred.path, cur.type);
    });
    return (dep, x = 0, y = 0) => {
      if (!dep) return hide();
      stop();
      cur = dep;
      ring.setAttribute("cx", String(x));
      ring.setAttribute("cy", String(y));
      mark.setAttribute("d", `M ${x - 3} ${y - 3} L ${x + 3} ${y + 3} M ${x + 3} ${y - 3} L ${x - 3} ${y + 3}`);
      xg.setAttribute("aria-label", tr().depTooltip(dep.type));
      xg.classList.add("is-visible");
    };
  }

  // successors whose dependency is broken (the red outline while arrows are hidden), judged even when the predecessor isn't on screen
  // read only kanbans that have cards and remember their current or next card and lane; a board with the same mtime isn't read again (unless the status setup changed)
  private async readCardSteps(): Promise<void> {
    const { statuses, autoStatus } = this.plugin.settings;
    const started = autoStatusTargets(statuses, autoStatus).started;
    const sig = JSON.stringify(statuses);
    const steps = new Map<string, { mtime: number; meta: CachedMetadata | null; started?: string; step: CardStep; done: CardDone[] }>();
    const read = new Map<string, KanbanLane["cards"]>(); // the cards of the boards read again
    await Promise.all(this.tasks.filter((t) => t.kind === "kanban" && t.cards).map(async (t) => {
      const file = this.app.vault.getAbstractFileByPath(t.path);
      if (!(file instanceof TFile)) return;
      const key = `${started}|${sig}`;
      const had = this.cardSteps.get(t.path);
      // right after a write the parse may still be the old one, so reuse only when the parse is the same too
      const meta = this.app.metadataCache.getFileCache(file);
      if (had && had.mtime === file.stat.mtime && had.meta === meta && had.started === key) return void steps.set(t.path, had);
      const lanes = kanbanLanes(meta, await this.app.vault.cachedRead(file));
      const step = kanbanStep(lanes, statuses, started);
      read.set(t.path, lanes.flatMap((l) => l.cards));
      steps.set(t.path, { mtime: file.stat.mtime, meta, started: key, step, done: [] });
    }));
    // when each step was done (for "done since last time"): its ✅ date when the card has one, else the day this computer first saw it ticked.
    // A tick counts wherever it was made (Kanban, the detail panel, another computer), and nothing is written into the notes
    if (read.size) {
      const seen = (this.app.loadLocalStorage(STEPS_KEY) as Record<string, StepsSeen> | null) ?? {};
      for (const p of Object.keys(seen)) if (!this.app.vault.getAbstractFileByPath(p)) delete seen[p]; // boards deleted or renamed are forgotten
      const today = this.today();
      for (const [path, cards] of read) {
        const { on } = (seen[path] = seeSteps(seen[path], cards, dayToStr(today), dayToStr(today - 30)));
        steps.get(path)!.done = cards.flatMap((c) => {
          const card = cardLabel(c.text);
          const day = c.done ? cardDoneOn(c.text) ?? on[card] : undefined;
          return day ? [{ card, on: day }] : [];
        });
      }
      this.app.saveLocalStorage(STEPS_KEY, seen);
    }
    this.cardSteps = steps;
  }

  // the execution board cue (one per row): the current or next card, else "Board". It opens the board in a new tab (separate from the row's click = details)
  private boardCue(host: HTMLElement, t: Task): void {
    const step = this.cardSteps.get(t.path)?.step;
    const say = step?.card ? (step.now ? tr().nowStep : tr().nextStep) : null;
    const text = say ? say(isolate(step!.card!)) : tr().boardCue;
    const hint = [tr().openBoardHint, t.cards ? tr().cardsChecked(t.cards.done, t.cards.total) : "", step?.stage ? isolate(step.stage) : ""].filter(Boolean).join(" · ");
    const cue = host.createEl("button", { cls: "ogantt-board-cue", attr: { "aria-label": `${text} · ${hint}`, title: `${text}\n${hint}`, tabindex: "-1" } });
    setIcon(cue.createSpan({ cls: "ogantt-board-cue-icon", attr: { "aria-hidden": "true" } }), KIND_ICON.kanban);
    // the card text keeps its own direction and is cut at its own end (a Hebrew card keeps its beginning); the translated words go around it
    // in the row only the board icon and the card text (readable when narrow); "Next card / Current card" goes into the tooltip and the label
    if (t.cards) cue.createSpan({ cls: "ogantt-board-cue-count", text: `${t.cards.done}/${t.cards.total}` });
    // a card starting with the row's own name doesn't repeat it ("DB Adapter — x" → "x")
    const card = say ? withoutName(step!.card!, t.name) : text;
    cue.createSpan({ cls: "ogantt-board-cue-text", text: card, attr: { dir: "auto" } });
    cue.addEventListener("click", (e) => {
      e.stopPropagation(); // not the row's click (which opens the details)
      this.openTask(t.path, Keymap.isModEvent(e) || "tab");
    });
  }

  // the panel's attention box: every reason, in as much detail as is known (a reason not recorded is said to be unknown), what this urgent work
  // interrupts, the subtasks' reasons, and the resume buttons
  private buildAttention(d: HTMLElement, t: Task): void {
    const { statuses } = this.plugin.settings;
    const today = this.today();
    const list = this.disabled.has(t.path) ? [] : exceptionsOf(t, statuses, today, this.conflicts, this.ints);
    const lines: [Exception | null, string][] = list.map((e) => [e, this.reasonOf(t, e)]);
    const links = isUrgent(t) && isOpen(t, statuses) ? (t.interrupts ?? []).filter((p) => this.ints.interrupted.get(p)?.some((u) => u.path === t.path)) : [];
    if (links.length) lines.push([null, tr().interruptsWhat(links.map((p) => isolate(this.nameOf(p))).join(", "))]);
    for (const c of this.tasks.filter((x) => x.parent === t.path && !this.disabled.has(x.path))) {
      const r = exceptionsOf(c, statuses, today, this.conflicts, this.ints);
      if (r.length) lines.push([null, tr().attSubtask(isolate(c.name), r.map((e) => EXC_TEXT[e]()).join(", "))]);
    }
    const resumable = this.resumable(t);
    if (!lines.length && !resumable.length) return;
    const box = d.createDiv({ cls: "ogantt-attention" + (list[0] ? ` is-${list[0]}` : ""), attr: { role: "note" } });
    for (const [e, text] of lines) {
      const line = box.createDiv({ cls: "ogantt-attention-line" });
      if (e) setIcon(line.createSpan({ cls: "ogantt-exc-icon", attr: { "aria-hidden": "true" } }), EXC_ICON[e]);
      line.createSpan({ text });
      if (e === "blocked") this.blockerField(line, t);
    }
    for (const target of resumable) {
      box.createEl("button", { cls: "mod-cta ogantt-attention-btn", text: tr().resumeTask(isolate(this.nameOf(target))) }).onclick = () => void this.resume(target);
    }
  }

  // the blocker field, after the status: what is written shows on the cards, People and the report too. Right after a task is blocked
  // (dropped on the column, or its status changed) the cursor goes here
  private blockerField(line: HTMLElement, t: Task): void {
    const input = line.createEl("input", { cls: "ogantt-blocker", type: "text", attr: { placeholder: tr().blockerAsk, "aria-label": tr().blockerAsk, dir: "auto" } });
    input.value = t.blocker ?? "";
    input.addEventListener("change", () => void this.saveField(this.plugin.settings.keys.blocker, input.value.trim()));
    if (this.askWhy !== t.path) return;
    this.askWhy = null;
    window.setTimeout(() => input.focus(), 0);
  }

  // an exception's reason in words: the due date, the blocking status (its reason in the field after it), the predecessors waited on,
  // the urgent work that interrupted and whose it is
  private reasonOf(t: Task, e: Exception): string {
    const { statuses, dateFormat } = this.plugin.settings;
    const names = (us: Task[] | undefined) => (us ?? []).map((u) => isolate(u.name) + (u.assignees.length ? ` (${u.assignees.map(linkLabel).join(", ")})` : "")).join(", ");
    switch (e) {
      case "urgent": return tr().excUrgent;
      case "overdue": return tr().attOverdue(formatDate(anchorEnd(t)!, dateFormat));
      case "blocked": return statuses.find((x) => x.id === t.status)?.label ?? t.status ?? ""; // its reason is in the field after it
      case "dependency": {
        const cal = scheduleOptions(this.plugin.settings).cal;
        const preds = t.deps.map((d) => [d, this.tasks.find((x) => x.path === d.path)] as const)
          .filter(([d, p]) => p && depViolated(t, p, d.type, cal)).map(([d, p]) => `${isolate(p!.name)} (${d.type})`);
        return tr().attDependency(preds.join(", "));
      }
      case "interrupted": return tr().interruptedBy(names(this.ints.interrupted.get(t.path)));
      case "resume": return tr().attResume(names(this.ints.resume.get(t.path)));
    }
  }

  // for a note in a read-only room, every input in the panel is disabled (open, close and Open board still work)
  private lockIfReadOnly(d: HTMLElement, path: string): void {
    if (!this.readOnly(path)) return;
    d.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>(
      ".ogantt-detail-head input, .ogantt-attention input, .ogantt-exec input, .ogantt-detail-meta input, .ogantt-detail-meta select, .ogantt-detail-meta textarea, .ogantt-detail-meta button, .ogantt-detail-body textarea, .ogantt-attention-btn",
    ).forEach((el) => (el.disabled = true));
  }

  // whether a note sits in a room Vault Rooms only lets you read: a write there is put back and leaves a local copy, so none is made. Without the
  // plugin, outside rooms, or while unknown, writing is allowed
  private readOnly(path: string): boolean {
    return this.roomsApi()?.canWrite?.(path) === false;
  }

  private roomsApi(): { canWrite?: (path: string) => boolean | null; onChange?: (listener: () => void) => () => void } | undefined {
    return (this.app as unknown as { plugins?: { plugins?: Record<string, { canWrite?: (path: string) => boolean | null; onChange?: (listener: () => void) => () => void }> } }).plugins?.plugins?.["vault-rooms"];
  }

  // when a Vault Rooms role changes (read-only ⇄ can edit), an open board follows. Vault Rooms may load after this view, so each render subscribes
  // if it hasn't yet; it redraws only when that changed, keeping selection, scroll and expanded rows
  private watchRooms(): void {
    if (this.roomsWatched) return;
    const off = this.roomsApi()?.onChange?.(() => {
      const now = this.tasks.filter((t) => this.readOnly(t.path)).map((t) => t.path).join("|");
      if (now === this.readOnlySeen) return;
      this.readOnlySeen = now;
      this.rerender();
      if (this.selectedPath && this.detailEl.hasClass("is-open")) void this.openDetail(this.selectedPath);
    });
    if (!off) return;
    this.roomsWatched = true;
    this.register(off);
  }

  private refuseReadOnly(paths: string[]): boolean {
    if (!paths.some((p) => this.readOnly(p))) return false;
    new Notice(tr().readOnlyNotice);
    return true;
  }

  private nameOf(path: string): string {
    return this.tasks.find((x) => x.path === path)?.name ?? path.split("/").pop()!.replace(/\.md$/, "");
  }

  // the tasks that can be resumed from this one: itself when waiting, or what it interrupted when it is finished urgent work (neither while other urgent work still runs)
  private resumable(t: Task): string[] {
    if (this.ints.resume.has(t.path)) return [t.path];
    return [...this.ints.resume].filter(([, us]) => us.some((u) => u.path === t.path)).map(([p]) => p);
  }

  // mark as urgent: write the priority, and a link to the person's work in the started status, into the urgent note (the interrupted note isn't
  // touched; undoable). One unshared candidate is linked as is; with several, or a shared one, the user picks (closing does nothing)
  private async setUrgent(t: Task, on: boolean): Promise<void> {
    const { keys, statuses, autoStatus } = this.plugin.settings;
    const write = async (targets: Task[]) => {
      await this.mutate(tr().undoEdit(t.name), [t.path], async () => {
        await writeField(this.app, t.path, keys.priority, on ? "urgent" : undefined);
        await writeField(this.app, t.path, keys.interrupts, targets.length ? targets.map((x) => this.linkTo(x.path, t.path)) : undefined);
      });
      await this.refresh();
    };
    if (!on) return write([]);
    if (this.refuseReadOnly([t.path])) return;
    const cands = runningWorkOf(t, this.tasks, autoStatusTargets(statuses, autoStatus).started);
    if (!cands.length || (cands.length === 1 && cands[0].assignees.length <= 1)) return write(cands);
    const mine = new Set(t.assignees.map(linkLabel));
    new ChoiceModal(this.app, {
      title: tr().pickInterruptTitle,
      body: tr().pickInterruptBody(t.assignees.map(linkLabel).join(", ")),
      choices: [
        ...cands.map((c) => {
          const others = c.assignees.map(linkLabel).filter((a) => !mine.has(a));
          return { text: c.name + (others.length ? tr().sharedWith(others.join(", ")) : ""), onPick: () => void write([c]) };
        }),
        { text: tr().pickNone, onPick: () => void write([]) },
      ],
      onDismiss: () => {},
    }).open();
  }

  // resume: drop the task from every finished urgent note linking it (undoable) and go back to it (its board for a kanban, its details otherwise); its status isn't changed
  private async resume(target: string): Promise<void> {
    const from = this.ints.resume.get(target) ?? [];
    if (!from.length) return;
    const ok = await this.mutate(tr().resumeTask(this.nameOf(target)), from.map((u) => u.path), async () => {
      for (const u of from) await removeLinkTo(this.app, u.path, this.plugin.settings.keys.interrupts, target);
    });
    if (!ok) return;
    await this.refresh();
    if (this.tasks.find((x) => x.path === target)?.kind === "kanban") this.openTask(target, "tab");
    else void this.openDetail(target);
  }

  private linkTo(path: string, from: string): string {
    const f = this.app.vault.getAbstractFileByPath(path);
    return f instanceof TFile ? `[[${this.app.metadataCache.fileToLinktext(f, from, true)}]]` : path;
  }

  private lateTasks(): Set<string> {
    const cal = scheduleOptions(this.plugin.settings).cal;
    const byPath = new Map(this.tasks.map((x) => [x.path, x]));
    return new Set(this.tasks.filter((t) => t.deps.some((d) => {
      const pred = byPath.get(d.path);
      return !!pred && depViolated(t, pred, d.type, cal);
    })).map((t) => t.path));
  }

  // drag a bar or diamond to reschedule; `place` redraws a bar while an edge is dragged (diamonds have none)
  private attachDrag(g: SVGGElement, handle: SVGElement, task: Task, place?: (x: number, w: number) => void): void {
    const EDGE = RESIZE_EDGE;
    const milestone = task.milestone;
    handle.addEventListener("pointerdown", (ev: PointerEvent) => {
      if (this.readOnly(task.path)) return; // a read-only room: no drag (a click still opens the details)
      ev.preventDefault();
      ev.stopPropagation();
      // preventDefault keeps focus on a previously focused input, so move it to the board (Ctrl+Z then reaches the gantt undo, in a pop-out too)
      this.contentEl.focus({ preventScroll: true });
      this.hideCard();
      this.dragged.set(g, false);
      const startX = ev.clientX;
      handle.setPointerCapture(ev.pointerId);
      // no redraw while the bar is held (removing it would drop the drag); always released once capture ends
      this.dragging = "bar";
      handle.addEventListener("lostpointercapture", () => { if (this.dragging === "bar") this.dragging = null; }, { once: true });

      let mode: "move" | "l" | "r" = "move";
      let x0 = 0;
      let w0 = 0;
      if (place) {
        x0 = parseFloat(handle.getAttribute("x")!);
        w0 = parseFloat(handle.getAttribute("width")!);
        // use screen box for offset; SVG offsetX is unreliable in Chromium
        const box = handle.getBoundingClientRect();
        const offset = ev.clientX - box.left;
        const edge = Math.min(EDGE, box.width / 4); // short bars keep a middle to move them by
        mode = offset < edge ? "l" : offset > box.width - edge ? "r" : "move";
      }

      const onMove = (e: PointerEvent) => {
        const dx = e.clientX - startX;
        if (Math.abs(dx) > 3) this.dragged.set(g, true);
        // a move slides the whole bar (progress, tag band, label); an edge resizes it (one day at least)
        if (mode === "move") g.setAttribute("transform", `translate(${dx},0)`);
        else if (mode === "r") place!(x0, Math.max(this.ppd, w0 + dx));
        else place!(x0 + Math.min(dx, w0 - this.ppd), Math.max(this.ppd, w0 - dx));
      };
      const onUp = (e: PointerEvent) => void (async () => {
        handle.releasePointerCapture(ev.pointerId);
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        this.dragging = null;
        // a move under 3px is a click: at small zooms a day is a few pixels, so a shaky click mustn't reschedule
        const dxDays = this.dragged.get(g) ? Math.round((e.clientX - startX) / this.ppd) : 0;
        if (dxDays !== 0) {
          // a row may hold a copy made for grouping (status, assignee, tag), so update the live task the cascade reads
          const live = this.tasks.find((x) => x.path === task.path) ?? task;
          await this.mutate(tr().undoReschedule(task.name), [task.path, ...this.cascadePaths(task.path)], async () => {
            if (milestone && !task.start) {
              const nd = dayToStr(dayIndex(task.end ?? task.start!) + dxDays);
              await writeDates(this.app, this.plugin.settings, task.path, nd, nd, true);
              live.end = nd; // update in-memory
            } else {
              const s0 = dayIndex(task.start!);
              const e0 = dayIndex(task.end ?? task.start!);
              let ns = s0;
              let ne = e0;
              if (mode === "move") {
                ns = s0 + dxDays;
                ne = e0 + dxDays;
              } else if (mode === "r") {
                ne = Math.max(s0, e0 + dxDays);
              } else {
                ns = Math.min(e0, s0 + dxDays);
              }
              const nsS = dayToStr(ns);
              const neS = dayToStr(ne);
              await writeDates(this.app, this.plugin.settings, task.path, nsS, neS, false);
              live.start = nsS; // update in-memory
              live.end = neS;
            }
            // cascade to successors
            await this.cascade([task.path]);
          });
          // render from memory for instant correct positions
          this.rerender();
        } else {
          // No day change = a click: reset any sub-threshold movement without re-rendering,
          // so the element survives and click/dblclick fire to open the detail panel.
          g.removeAttribute("transform");
          place?.(x0, w0);
        }
      })();
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      // a cancelled pointer (touch, pen) just puts the bar back
      handle.addEventListener("pointercancel", () => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        g.removeAttribute("transform");
        place?.(x0, w0);
      }, { once: true });
    });
  }

  // ----- create a new task -----
  // create a 1-day task (start = end = today) in the current folder, then open the panel to name it (a canvas also gets its .canvas)
  private async createNewTask(kind: TaskKind = "note"): Promise<void> {
    const folder = await this.newTaskFolder();
    if (this.refuseReadOnly([normalizePath(`${folder}/${tr().newTaskName}.md`)])) return; // a note made in a read-only room would stay on this computer only
    let created: string[] = [];
    await this.mutate(tr().undoCreate(tr().newTaskName), [], async () => {
      created = await createTask(this.app, this.plugin.settings, folder, tr().newTaskName, kind);
      // a one-day task today on the timeline; on the board and team undated, in the not-started status (so it doesn't turn up overdue on top the next day)
      const { statuses, autoStatus, keys } = this.plugin.settings;
      const todo = autoStatusTargets(statuses, autoStatus).notStarted[0];
      if (this.layout === "timeline") {
        const today = dayToStr(this.today());
        await writeDates(this.app, this.plugin.settings, created[0], today, today, false);
      }
      if (todo) await writeField(this.app, created[0], keys.status, todo);
      return { created };
    });
    if (!created.length) return;
    await this.refresh();
    await this.openDetail(created[0], true);
  }

  // where a new task goes. When the board's folder is outside every shared room (Vault Rooms) but holds rooms you can edit, the user picks
  // where (a note made outside would be shared with nobody); closing the picker creates nothing (the promise never settles)
  private newTaskFolder(): Promise<string> {
    const role = (dir: string) => this.roomsApi()?.canWrite?.(normalizePath(`${dir}/x.md`));
    const parent = (dir: string) => (dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) : "");
    const inRoom = (dir: string) => role(dir) != null;
    const rooms = this.allFolders.map((f) => (this.folder ? `${this.folder}/${f.join("/")}` : f.join("/"))).filter((d) => role(d) === true && !inRoom(parent(d)));
    if (inRoom(this.folder) || !rooms.length) return Promise.resolve(this.folder);
    const here = (d: string) => (d === this.folder ? `${d || tr().vaultRoot} — ${tr().notShared}` : d);
    return new Promise((resolve) => new PickModal(this.app, [...rooms, this.folder], here, tr().pickRoom, resolve).open());
  }

  // ----- drag & drop (onto a folder = detach + move; onto a task = make subtask) -----
  // make a task row draggable
  private makeDraggableTask(row: HTMLElement, path: string): void {
    row.setAttr("draggable", "true");
    row.addEventListener("dragstart", (e: DragEvent) => {
      e.dataTransfer?.setData("text/plain", path);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      this.dragPath = path;
      this.hideCard();
      row.addClass("is-dragging");
    });
    row.addEventListener("dragend", () => {
      this.dragPath = null;
      row.removeClass("is-dragging");
    });
  }

  // make a row a drop target; while hovering, the row shows what a drop will do
  // on a task row, dropping in the top or bottom quarter places the dragged row before or after it (the middle runs `handler`)
  private makeDropTarget(row: HTMLElement, label: string, handler: (srcPath: string) => void): void {
    const target = row.dataset.path;
    const zone = (e: DragEvent): "before" | "after" | null => {
      if (!target) return null;
      const r = row.getBoundingClientRect();
      const y = (e.clientY - r.top) / r.height;
      return y < 0.25 ? "before" : y > 0.75 ? "after" : null;
    };
    const clear = () => row.removeClass("is-drop-target", "is-drop-before", "is-drop-after");
    row.addEventListener("dragover", (e: DragEvent) => {
      if (this.dragPath != null && this.dragPath === target) return; // not onto itself
      e.preventDefault(); // allow dropping
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      const z = zone(e);
      row.dataset.dropLabel = z ? tr().dropReorder : label;
      row.toggleClass("is-drop-target", !z);
      row.toggleClass("is-drop-before", z === "before");
      row.toggleClass("is-drop-after", z === "after");
    });
    row.addEventListener("dragleave", (e: DragEvent) => {
      if (!row.contains(e.relatedTarget as Node | null)) clear();
    });
    row.addEventListener("drop", (e: DragEvent) => {
      e.preventDefault();
      clear();
      this.dragPath = null;
      const src = e.dataTransfer?.getData("text/plain");
      const z = zone(e);
      if (src && z && target) this.placeRow(src, target, z);
      else if (src) handler(src);
    });
  }

  // a task's folder dir ("" = vault root)
  private taskFolder(path: string): string {
    return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  }

  // set/clear parent, move subtree, re-render (undoable)
  private async reparentTo(srcPath: string, destFolder: string, parentTaskPath: string | null): Promise<void> {
    if (srcPath === parentTaskPath) return; // not onto itself
    if (this.refuseReadOnly([srcPath, normalizePath(`${destFolder}/${srcPath.split("/").pop()}`)])) return;
    // cycle guard: parent must not be a descendant of src
    if (parentTaskPath && subtreePaths(this.tasks, srcPath).includes(parentTaskPath)) {
      new Notice(tr().cycleBlocked);
      return;
    }
    const pf = parentTaskPath ? this.app.vault.getAbstractFileByPath(parentTaskPath) : null;
    const parentFile = pf instanceof TFile ? pf : null;
    const name = this.tasks.find((t) => t.path === srcPath)?.name ?? srcPath;
    const label = parentTaskPath ? tr().undoSubtask(name) : tr().undoDetach(name);
    let moves: Move[] = [];
    const ok = await this.mutate(label, [srcPath], async () => {
      const res = await reparentTask(this.app, this.plugin.settings, this.tasks, srcPath, destFolder, parentFile);
      if (!res) return false;
      moves = res.moves;
      return { moves };
    });
    if (!ok) return;
    const srcMove = moves.find((m) => m.from === srcPath);
    if (srcMove && this.selectedPath === srcPath) this.selectedPath = srcMove.to;
    await this.refresh();
  }

  // add or remove one tag / assignee (undoable; a no-op change does nothing) and mirror it in memory for an instant redraw.
  // An inline #tag can't be removed from here, so when the write changed nothing the in-memory task is left alone too
  private async editList(path: string, field: "tags" | "assignees", value: string, add: boolean): Promise<void> {
    const t = this.tasks.find((x) => x.path === path);
    // people compare by display name ("Ben" and "[[Ben]]" are one person)
    const same = (v: string) => (field === "assignees" ? linkLabel(v) === linkLabel(value) : v.toLowerCase() === value.toLowerCase());
    if (!t || !value || add === t[field].some(same)) return;
    const next = add ? [...t[field], value] : t[field].filter((v) => !same(v));
    const label = field === "assignees" ? tr().undoEdit(t.name) : add ? tr().undoAddTag(t.name, value) : tr().undoRemoveTag(t.name, value);
    const ok = await this.mutate(label, [path], async () => {
      // re-read the frontmatter and change just this one entry (a moment-earlier edit survives)
      if (field === "assignees") return editListField(this.app, path, this.plugin.settings.keys.assignee, value, add);
      return add ? (await addTag(this.app, path, value)) || false : removeTag(this.app, path, value);
    });
    // look up the live task (survives a background refresh)
    const live = this.tasks.find((x) => x.path === path);
    if (ok && live) live[field] = next;
    // an added tag joins the suggestions (that list reads the whole vault, so it's kept for the view's life)
    if (ok && add && field === "tags" && this.tagCache && !this.tagCache.includes(value)) this.tagCache.push(value);
    this.rerender();
  }

  // chips for tags / assignees (× removes) plus an add field (Enter adds); shared by the detail panel and the table popover. Returns the field
  private chipList(host: HTMLElement, now: () => string, field: "tags" | "assignees", changed: () => void): HTMLInputElement {
    const path = now();
    const t = this.tasks.find((x) => x.path === path);
    const values = t?.[field] ?? [];
    const tags = field === "tags";
    for (const v of values) {
      const chip = host.createSpan({ cls: "ogantt-tag-chip" });
      if (tags) {
        this.paintTagChip(chip, v);
        chip.createSpan({ text: v });
        chip.addEventListener("contextmenu", (e) => this.openStyleMenu(e, "tag", v));
      } else {
        chip.addClass("ogantt-person-chip");
        this.avatar(chip, v);
        renderLinkValue(chip, v, "").addEventListener("click", (e) => handleLinkClick(this.app, e, path));
      }
      const x = chip.createEl("button", { cls: "ogantt-date-x clickable-icon", attr: { "aria-label": tags ? tr().removeTagAria : tr().removeAssigneeAria } });
      setIcon(x, "x");
      x.onclick = () => void this.editList(now(), field, v, false).then(changed);
    }
    const add = host.createEl("input", { cls: "ogantt-tag-add", type: "text", attr: { placeholder: tags ? tr().addTagPlaceholder : tr().addAssigneePlaceholder } });
    // suggest existing values to avoid spelling drift ("[[" suggests notes for assignees)
    if (tags) this.attachSingleTagSuggestions(add, values);
    else {
      const names = this.assigneeList().filter((a) => !values.some((v) => linkLabel(v) === linkLabel(a)));
      if (names.length) this.attachSuggestions(add, (list) => names.forEach((n) => list.createEl("option", { value: n })));
      attachLinkSuggest(this.app, add, path);
    }
    add.addEventListener("keydown", (e) => { if (e.key === "Enter" && !composing(e)) { e.preventDefault(); add.blur(); } });
    add.addEventListener("change", () => {
      const v = tags ? add.value.trim().replace(/^#/, "") : add.value.trim();
      if (v) void this.editList(now(), field, v, true).then(changed);
    });
    return add;
  }

  // the done-subtasks pill (cancelled ones don't count; none shows when nothing counts, so all-cancelled isn't "0/0")
  private subtaskPill(host: HTMLElement, kids: Task[]): void {
    const sum = subtaskSummary(kids, this.plugin.settings.statuses);
    if (sum.total) host.createSpan({ cls: "ogantt-subtask-sum", text: `${sum.done}/${sum.total}`, attr: { title: tr().execComplete(sum.done, sum.total) } });
  }

  // an assignee avatar (initials in a circle)
  private avatar(parent: HTMLElement, who: string): void {
    const c = this.assigneeColor(who);
    const av = parent.createSpan({ cls: "ogantt-avatar", text: initials(linkLabel(who)) });
    av.style.background = c;
    av.style.color = inkOn(c);
  }

  // ----- editable detail slide-over -----
  private async openDetail(path: string, focusTitle = false): Promise<void> {
    const t = this.tasks.find((x) => x.path === path);
    if (!t) return;
    const d = this.detailEl;
    // redrawing the same task keeps the panel's scroll position
    const again = this.isDetailOpenFor(path);
    const keepScroll = again ? d.scrollTop : 0;
    const barX = again ? null : this.barAt(path); // where its bar is before the panel opens
    const seq = ++this.detailSeq;
    this.selectedPath = path;
    // the blocker question belongs to the blocked task's panel; a redraw before the index catches up has no field yet, so it waits for one
    // (opening another task drops it)
    if (this.askWhy !== path) this.askWhy = null;
    // unload the previous task's rendered body (embeds, Dataview, …)
    if (this.bodyOwner) this.removeChild(this.bodyOwner);
    this.bodyOwner = null;
    // refresh the selection highlight (copies included); Esc returns to this task's row
    this.markSelected(path);
    const at = this.rows.findIndex((r) => r.task?.path === path);
    if (at >= 0 && this.rows[this.cursor]?.task?.path !== path && !this.tbodyEl?.contains(activeDocument.activeElement)) this.cursor = at;

    const k = this.plugin.settings.keys;
    d.empty();
    const was = d.hasClass("is-open");
    d.addClass("is-open");
    // on phones the panel fills the screen (width from CSS)
    if (!Platform.isPhone) d.style.width = `${this.plugin.settings.detailWidth}px`;
    if (!was && !Platform.isPhone) this.rerender(); // narrow the table to the name column
    if (!again) this.holdBar(path, barX, true);

    // left-edge width resize handle
    const resizer = d.createDiv({ cls: "ogantt-detail-resizer" });
    this.attachResize(resizer, d);

    // header: title input renames the file
    const header = d.createDiv({ cls: "ogantt-detail-head" });
    const titleInput = header.createEl("input", { cls: "ogantt-detail-title", type: "text", attr: { "aria-label": tr().fieldName, dir: "auto" } });
    titleInput.value = t.name;
    // when the rename didn't happen (name taken, …) the field goes back to the current name
    titleInput.addEventListener("change", () => void this.renameTaskTo(this.selectedPath!, t.name, titleInput.value).then(() => {
      titleInput.value = this.tasks.find((x) => x.path === this.selectedPath)?.name ?? titleInput.value;
    }));
    // select the name right after creation
    if (focusTitle) window.setTimeout(() => { titleInput.focus(); titleInput.select(); }, 0);
    const openBtn = header.createEl("button", { cls: "clickable-icon" });
    setIcon(openBtn, "external-link");
    openBtn.setAttr("aria-label", tr().openAsNote);
    openBtn.onclick = () => this.openTask(this.selectedPath!, "tab");
    // trash icon = delete menu
    const delBtn = header.createEl("button", { cls: "clickable-icon" });
    setIcon(delBtn, "trash-2");
    delBtn.setAttr("aria-label", tr().menuDelete);
    delBtn.onclick = (e) => {
      const m = new Menu();
      m.addItem((i) => i.setTitle(tr().menuDelete).setIcon("trash-2").onClick(() => {
        if (this.selectedPath) this.confirmDelete(this.selectedPath);
      }));
      m.showAtMouseEvent(e);
    };
    const closeBtn = header.createEl("button", { cls: "clickable-icon", attr: { "aria-label": tr().close } });
    setIcon(closeBtn, "x");
    closeBtn.onclick = () => this.closeDetail(true);

    if (this.readOnly(t.path)) d.createDiv({ cls: "ogantt-readonly", text: tr().readOnlyPanel, attr: { role: "note" } });
    this.buildAttention(d, t);
    const execHost = d.createDiv(); // a kanban's Execution; before the fields when the setting says top
    const meta = d.createDiv({ cls: "ogantt-detail-meta" });
    const fieldRow = (label: string): HTMLElement => {
      const r = meta.createDiv({ cls: "ogantt-detail-row" });
      r.createSpan({ cls: "ogantt-detail-label", text: label });
      return r.createDiv({ cls: "ogantt-detail-field" });
    };

    // start & end via one range calendar (ClickUp-style: side by side, each clearable with ×)
    this.buildDates(meta, t);

    // status
    const statusSel = fieldRow(tr().fieldStatus).createEl("select", { cls: "dropdown", attr: { "aria-label": tr().fieldStatus } });
    statusSel.createEl("option", { text: "—", value: "" });
    for (const s of this.plugin.settings.statuses) {
      const opt = statusSel.createEl("option", { text: s.label, value: s.id });
      if (s.id === t.status) opt.selected = true;
    }
    // blocking asks why (the panel isn't redrawn while its select has focus, so it's reopened here)
    statusSel.addEventListener("change", () => void this.saveField(k.status, statusSel.value).then(() => {
      if (statusGroupOf(this.plugin.settings.statuses, statusSel.value) !== "deferred" || !this.selectedPath) return;
      this.askWhy = this.selectedPath;
      return this.openDetail(this.selectedPath);
    }));

    // assignees and tags (multi-valued): × on a chip removes, input + Enter adds ("[[" picks a note as an assignee; drag & drop adds too)
    const reopen = () => { if (this.selectedPath) void this.openDetail(this.selectedPath); };
    // the current path, so an action pressed right after a rename from the title (before the panel is redrawn) doesn't use the old one
    const here = () => this.selectedPath ?? t.path;
    for (const [field, label] of [["assignees", tr().fieldAssignee], ["tags", tr().fieldTags]] as const) {
      const row = fieldRow(label);
      row.addClass("ogantt-tags-field");
      this.chipList(row, here, field, reopen);
      if (field === "assignees") wireLinkHover(this.app, row, this, t.path);
    }

    // parent task (shown when set; × detaches. set via drag)
    if (t.parent) {
      const pf = fieldRow(tr().fieldParent);
      const parentTask = this.tasks.find((x) => x.path === t.parent);
      const chip = pf.createSpan({ cls: "ogantt-parent-chip" });
      chip.createSpan({ text: parentTask?.name ?? t.parent });
      const x = chip.createEl("button", { cls: "ogantt-date-x clickable-icon" });
      setIcon(x, "x");
      x.setAttr("aria-label", tr().clearDate);
      x.addEventListener("click", () => void (async () => {
        if (!this.selectedPath) return;
        await this.reparentTo(this.selectedPath, this.taskFolder(this.selectedPath), null); // detach
        if (this.selectedPath) await this.openDetail(this.selectedPath); // refresh the panel
      })());
    }

    // dependencies (the tasks this one waits on): × removes one (undoable), "Add dependency…" picks a type and then the predecessor; the same as dragging a bar's handle
    const depField = fieldRow(tr().fieldDeps);
    depField.addClass("ogantt-tags-field");
    for (const dep of t.deps) {
      const chip = depField.createSpan({ cls: "ogantt-tag-chip ogantt-dep-chip" });
      chip.createSpan({ cls: "ogantt-dep-chip-type", text: dep.type });
      chip.createSpan({ text: this.tasks.find((x) => x.path === dep.path)?.name ?? dep.path });
      const x = chip.createEl("button", { cls: "ogantt-date-x clickable-icon", attr: { "aria-label": tr().undoRemoveDep(dep.type) } });
      setIcon(x, "x");
      x.onclick = () => void this.removeDep(here(), dep.path, dep.type).then(reopen);
    }
    const depType = depField.createEl("select", { cls: "dropdown ogantt-dep-type-select", attr: { "aria-label": tr().fieldDeps } });
    const words: Record<DepType, string> = { FS: tr().depFS, SS: tr().depSS, FF: tr().depFF };
    for (const ty of ["FS", "SS", "FF"] as DepType[]) depType.createEl("option", { value: ty, text: words[ty] });
    const addDepBtn = depField.createEl("button", { cls: "ogantt-dep-add", text: tr().addDependency });
    addDepBtn.onclick = () => {
      // leave out itself, its predecessors and its successors (picking one would close a loop)
      const taken = new Set([t.path, ...t.deps.map((x) => x.path), ...successorClosure(this.tasks, t.path, true)]);
      new PickModal(this.app, this.tasks.filter((x) => !taken.has(x.path)), (x) => this.taskLabel(x), tr().addDependency, (pred) =>
        void this.addDep(pred.path, here(), depType.value as DepType).then(reopen)).open();
    };

    // progress slider + % label; updates the label while dragging, saves on release (reflected in the bar)
    // a board with cards shows its count under Execution, not here too
    const progField = t.cards ? createDiv() : fieldRow(tr().fieldProgress);
    progField.addClass("ogantt-progress-field");
    if (t.cards) {
      // a kanban with cards takes its progress from the share of checked cards (checking cards on the board moves it; not edited here)
      paintProgress(progField.createDiv(), t);
    } else {
      const progRange = progField.createEl("input", { type: "range", attr: { "aria-label": tr().fieldProgress } });
      progRange.min = "0";
      progRange.max = "100";
      progRange.step = "5";
      progRange.value = String(t.progress ?? 0);
      const progVal = progField.createSpan({ cls: "ogantt-progress-val", text: `${progressPct(t) ?? 0}%` });
      progRange.addEventListener("input", () => progVal.setText(`${progRange.value}%`));
      progRange.addEventListener("change", () => void (async () => {
        const path = this.selectedPath;
        if (!path) return;
        // drop at 0% (unset), otherwise store the number
        const n = Number(progRange.value);
        await this.mutate(tr().undoEdit(t.name), [path], () => writeField(this.app, path, k.progress, n > 0 ? n : undefined));
        await this.refresh();
      })());
    }

    // urgent (interrupting) work can be switched here too, not only from the right-click menu; other values (high, …) are shown as they are
    const pf = fieldRow(tr().fieldPriority);
    if (t.priority && !isUrgent(t)) pf.createSpan({ cls: "ogantt-muted", text: t.priority, attr: { dir: "auto" } });
    pf.createEl("button", { text: isUrgent(t) ? tr().menuClearUrgent : tr().menuMarkUrgent }).onclick = () => void this.setUrgent(t, !isUrgent(t));

    // Google Calendar sync (shown only while connected)
    const g = this.plugin.settings.gcal;
    if (g.calendarId && isConnected(this.plugin)) {
      const gf = fieldRow(tr().fieldGcal);
      const box = gf.createEl("input", { type: "checkbox" });
      const file = this.app.vault.getAbstractFileByPath(t.path);
      const fm: Record<string, unknown> | undefined = file instanceof TFile
        ? this.app.metadataCache.getFileCache(file)?.frontmatter
        : undefined;
      const flag = fm?.[k.gcal];
      box.checked = !g.optInOnly || flag === true || flag === "true";
      box.disabled = !g.optInOnly; // no per-task choice when everything syncs
      box.addEventListener("change", () => void (async () => {
        const path = this.selectedPath;
        if (!path) return;
        await this.mutate(tr().undoEdit(t.name), [path], () => writeField(this.app, path, k.gcal, box.checked ? true : undefined));
        schedulePush(this.plugin); // schedule the push (or the opt-out cleanup)
      })());
      const link = g.state[t.path]?.link;
      if (link) {
        const a = gf.createEl("a", { text: tr().gcalOpenEvent, href: link });
        a.setAttr("target", "_blank");
      }
    }

    // body: rendered like Obsidian's reading view by default; click to edit, blur saves and returns to the rendered view
    // read once (a kanban counts its lanes from the whole text, not the body)
    const file = this.app.vault.getAbstractFileByPath(t.path);
    const text = file instanceof TFile ? await this.app.vault.cachedRead(file) : "";
    let bodyText = bodyOf(text);
    if (seq !== this.detailSeq) return; // a newer build started while reading
    this.panelSig = this.sigOf(t, bodyText);
    if (t.kind === "kanban") {
      // a kanban is the execution layer: no board squeezed into the narrow panel, just a short summary and "Open board"; counts and the next card only when they can be read for sure
      if (!(file instanceof TFile)) return;
      if (this.plugin.settings.execPosition !== "top") d.appendChild(execHost); // after the fields by default
      execHost.createDiv({ cls: "ogantt-detail-label", text: tr().boardCue });
      const ex = execHost.createDiv({ cls: "ogantt-exec" });
      if (t.cards) ex.createDiv({ text: tr().cardsChecked(t.cards.done, t.cards.total) });
      const { statuses, autoStatus } = this.plugin.settings;
      const lanes = kanbanLanes(this.app.metadataCache.getFileCache(file), text);
      const step = kanbanStep(lanes, statuses, autoStatusTargets(statuses, autoStatus).started);
      if (step.card) ex.createDiv({ cls: "ogantt-exec-card", text: (step.now ? tr().nowStep : tr().nextStep)(isolate(withoutName(step.card, t.name))) });
      if (step.stage) ex.createDiv({ cls: "ogantt-exec-stage", text: tr().inLane(isolate(step.stage)) });
      // for the specifics: every card, lane by lane. A card can be checked here (undoable); editing its text and reordering happen on the board
      const count = lanes.reduce((n, l) => n + l.cards.length, 0);
      if (count) {
        // one direction for the whole board (right-to-left when mostly Hebrew and the like), so rows don't flip one by one
        const words = lanes.map((l) => l.title + " " + l.cards.map((c) => c.text).join(" ")).join(" ");
        const dir = (words.match(/[\p{Script=Hebrew}\p{Script=Arabic}]/gu)?.length ?? 0) * 2 > (words.match(/\p{L}/gu)?.length ?? 0) ? "rtl" : "ltr";
        let marked = false; // the current or next card is marked once
        const tick = (c: KanbanLane["cards"][number], done: boolean) => void this.mutate(tr().undoEdit(t.name), [t.path], async () => {
          let stale = false;
          await this.app.vault.process(file, (s) => setCardDone(s, c.line, c.text, done) ?? ((stale = true), s));
          if (stale) {
            new Notice(tr().cardStale);
            void this.refresh();
          }
          return !stale;
        });
        const cards = (host: HTMLElement, lane: KanbanLane) => {
          for (const c of lane.cards) {
            const next = !marked && !c.done && lane.title === step.stage && cardLabel(c.text) === step.card;
            if (next) marked = true;
            // wrapped in a label, so a click on the text toggles it too
            const row = host.createEl("label", { cls: "ogantt-exec-item" + (c.done ? " is-done" : "") + (next ? " is-next" : "") });
            const box = row.createEl("input", { type: "checkbox" });
            box.checked = c.done;
            box.onchange = () => { this.cardFocus = `${t.path}:${c.line}`; tick(c, box.checked); };
            if (this.cardFocus === `${t.path}:${c.line}`) {
              this.cardFocus = null;
              window.setTimeout(() => box.focus({ preventScroll: true }));
            }
            row.createSpan({ text: cardLabel(c.text), attr: { dir: "auto" } });
          }
        };
        const counted = (lane: KanbanLane) => `${lane.cards.filter((c) => c.done).length}/${lane.cards.length}`;
        if (this.plugin.settings.cardView === "board") {
          // side-by-side lanes like the Kanban plugin (in its left-to-right order)
          const board = ex.createDiv({ cls: "ogantt-kanban" });
          for (const lane of lanes) {
            const col = board.createDiv({ cls: "ogantt-kanban-lane", attr: { dir } });
            const head = col.createDiv({ cls: "ogantt-kanban-title" });
            head.createSpan({ text: lane.title });
            head.createSpan({ cls: "ogantt-exec-count", text: counted(lane) });
            cards(col, lane);
          }
        } else {
          const all = ex.createEl("details", { cls: "ogantt-exec-all" });
          all.open = this.cardsOpen;
          all.ontoggle = () => (this.cardsOpen = all.open);
          all.createEl("summary", { text: tr().allCards(count) });
          const list = all.createDiv({ attr: { dir } });
          for (const lane of lanes) {
            const head = list.createDiv({ cls: "ogantt-exec-lane" });
            head.createSpan({ text: lane.title });
            head.createSpan({ cls: "ogantt-exec-count", text: counted(lane) });
            cards(list.createDiv({ cls: "ogantt-exec-cards" }), lane);
          }
        }
      }
      const open = ex.createEl("button", { cls: "mod-cta ogantt-exec-open", text: tr().openBoard, attr: { "aria-label": tr().openBoardHint } });
      open.onclick = (e) => this.openTask(here(), Keymap.isModEvent(e) || "tab");
      this.lockIfReadOnly(d, t.path);
      d.scrollTop = keepScroll;
      return;
    }
    d.createDiv({ cls: "ogantt-detail-label", text: tr().fieldBody });
    const bodyWrap = d.createDiv({ cls: "ogantt-detail-body" });
    const preview = bodyWrap.createDiv({ cls: "ogantt-detail-body-preview markdown-rendered" });
    const bodyArea = bodyWrap.createEl("textarea", { cls: "ogantt-detail-body-edit", attr: { "aria-label": tr().fieldBody, dir: "auto" } });

    const renderPreview = async (): Promise<void> => {
      if (seq !== this.detailSeq) return; // the panel shows another task by now
      preview.empty();
      // a fresh owner per render unloads the previous render's embeds, Dataview blocks, …
      if (this.bodyOwner) this.removeChild(this.bodyOwner);
      this.bodyOwner = this.addChild(new Component());
      if (bodyText.trim()) await MarkdownRenderer.render(this.app, bodyText, preview, t.path, this.bodyOwner);
      else preview.createSpan({ cls: "ogantt-muted", text: tr().noneLabel });
    };
    await renderPreview();

    const autosize = () => {
      // reset, then fit to content
      bodyArea.setCssStyles({ height: "auto" });
      bodyArea.setCssStyles({ height: `${bodyArea.scrollHeight + 2}px` });
    };
    wireLinkHover(this.app, preview, this, t.path);
    preview.addEventListener("click", (e) => {
      // clicks on links or checkboxes don't enter edit mode
      if (handleLinkClick(this.app, e, t.path)) return;
      if ((e.target as HTMLElement).closest("input")) return;
      if (this.readOnly(t.path)) return; // read-only: no editing
      bodyArea.value = bodyText;
      bodyWrap.addClass("is-editing");
      autosize();
      bodyArea.focus();
    });
    bodyArea.addEventListener("input", autosize);
    attachLinkSuggest(this.app, bodyArea, t.path);
    bodyArea.addEventListener("blur", () => void (async () => {
      const path = this.selectedPath;
      // the note was deleted while typing: the text goes to the clipboard (never silently lost)
      if (path && bodyArea.value !== bodyText && !this.app.vault.getAbstractFileByPath(path)) {
        const text = bodyArea.value;
        const electron = (window as unknown as { require?: (m: string) => { clipboard?: { writeText(s: string): void } } }).require?.("electron");
        const kept = await (electron?.clipboard ? Promise.resolve(electron.clipboard.writeText(text)) : navigator.clipboard.writeText(text)).then(() => true, () => false);
        new Notice(kept ? tr().bodyKeptOnClipboard : tr().writeFailed);
        if (!kept) bodyArea.focus(); // not copied: the text stays in the field (the panel stays open)
        return;
      }
      if (path && bodyArea.value !== bodyText) {
        // say so when the note changed elsewhere meanwhile (Undo brings that version back)
        if ((await readBody(this.app, path)) !== bodyText) new Notice(tr().bodyChangedElsewhere);
        bodyText = bodyArea.value;
        await this.mutate(tr().undoEdit(t.name), [path], () => writeBody(this.app, path, bodyText));
      }
      bodyWrap.removeClass("is-editing");
      await renderPreview();
    })());
    if (seq !== this.detailSeq) return; // another task opened meanwhile: its fields aren't locked
    this.lockIfReadOnly(d, t.path);
    d.scrollTop = keepScroll;
  }

  // open a task's note by its file, so a "#" in the name isn't read as a link to a heading
  private openTask(path: string, newLeaf: PaneType | boolean): void {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) return;
    const leaf = this.app.workspace.getLeaf(newLeaf);
    void leaf.openFile(f).then(() => {
      // the Kanban plugin draws boards; without it the note opens as Markdown, so say how to reorder cards there
      if (this.tasks.find((x) => x.path === path)?.kind === "kanban" && leaf.view.getViewType() === "markdown") new Notice(tr().boardAsMarkdown, 8000);
    });
  }

  // confirm, then delete the task (to trash)
  private confirmDelete(path: string): void {
    const t = this.tasks.find((x) => x.path === path);
    if (!t) return;
    const hasChildren = this.tasks.some((x) => x.parent === path);
    // a canvas task takes its .canvas along (undo brings both back), unless another note links to that canvas too
    const shared = !!t.canvas && Object.entries(this.app.metadataCache.resolvedLinks).some(([src, links]) => src !== path && !!links[t.canvas!]);
    const canvas = shared ? undefined : t.canvas;
    const files = canvas ? [path, canvas] : [path];
    // links naming it as parent or predecessor go too (so a new task of that name doesn't inherit them)
    const linking = this.tasks.filter((x) => x.parent === path || x.deps.some((d) => d.path === path)).map((x) => x.path);
    const sub = [hasChildren ? tr().confirmDeleteChildren : "", canvas ? tr().confirmDeleteCanvas(canvas.split("/").pop()!) : ""].join(" ").trim();
    new ConfirmModal(this.app, {
      title: tr().confirmDeleteTitle,
      body: tr().confirmDeleteBody(t.name),
      sub: sub || undefined,
      confirmText: tr().menuDelete,
      cancelText: tr().cancel,
      onConfirm: () => void (async () => {
        const ok = await this.mutate(tr().undoDelete(t.name), [...files, ...linking], async () => {
          const k = this.plugin.settings.keys;
          for (const p of linking) {
            await removeLinkTo(this.app, p, k.parent, path);
            await removeDependency(this.app, this.plugin.settings, p, path);
          }
          const gone: string[] = [];
          for (const p of files) if (await deleteTask(this.app, p)) gone.push(p);
          return gone.length ? { deleted: gone } : false;
        });
        if (!ok) return;
        // close the detail panel if it showed the deleted task
        if (this.selectedPath === path) this.closeDetail();
        new Notice(tr().deletedNotice(t.name));
        await this.refresh();
      })(),
    }).open();
  }

  // save a frontmatter field (delete if empty)
  private async saveField(key: string, value: string): Promise<void> {
    const path = this.selectedPath;
    if (!path) return;
    const name = this.tasks.find((x) => x.path === path)?.name ?? path;
    const s = this.plugin.settings;
    // a status is written together with its completion day
    await this.mutate(tr().undoEdit(name), [path], () => (key === s.keys.status ? writeStatus(this.app, path, s, value || undefined, dayToStr(this.today())) : writeField(this.app, path, key, value === "" ? undefined : value)));
    await this.refresh();
  }

  // dates area: start & end chips side by side, each clearable with ×, click opens the range calendar
  private buildDates(meta: HTMLElement, t: Task): void {
    const fmt = this.plugin.settings.dateFormat;
    const state = { start: t.start ?? "", end: t.end ?? "" };
    // optional time of day, editable only when the date is set
    const times = { start: t.startTime ?? "", end: t.endTime ?? "" };

    const row = meta.createDiv({ cls: "ogantt-detail-row" });
    row.createSpan({ cls: "ogantt-detail-label", text: tr().fieldDates });
    const chips = row.createDiv({ cls: "ogantt-detail-field ogantt-date-chips" });

    const painters: (() => void)[] = [];
    const repaint = () => painters.forEach((p) => p());

    // persist both ends (delete when empty; append the time of day when set)
    const save = async (): Promise<void> => {
      if (!this.selectedPath) return;
      // "start only" isn't valid: fill end = start
      if (state.start && !state.end) state.end = state.start;
      // clamp so start ≤ end within the same day
      if (state.start && state.start === state.end && times.start && times.end && times.end < times.start) {
        times.end = times.start;
      }
      repaint(); // reflect any clamping right away
      state.end = await this.reschedule(this.selectedPath, state, times);
      repaint(); // show a due date moved to keep the duration
    };

    const makeChip = (which: "start" | "end"): void => {
      const chip = chips.createDiv({ cls: "ogantt-date-chip" });
      const ico = chip.createSpan({ cls: "ogantt-date-ico" });
      setIcon(ico, "calendar");
      chip.createSpan({ cls: "ogantt-date-cap", text: which === "start" ? tr().colStart : tr().colDue });
      const val = chip.createEl("button", { cls: "ogantt-date-val", attr: { "data-focus": `date-${which}` } });
      const x = chip.createEl("button", { cls: "ogantt-date-x clickable-icon" });
      setIcon(x, "x");
      x.setAttr("aria-label", tr().clearDate);
      const paint = () => {
        const iso = state[which];
        // × visibility is handled by CSS via .is-empty
        if (iso) {
          // show the time of day after the date when set
          val.setText(formatDate(iso, fmt) + (times[which] ? ` ${times[which]}` : ""));
          chip.removeClass("is-empty");
        } else {
          val.setText(which === "start" ? tr().fieldStart : tr().fieldDue);
          chip.addClass("is-empty");
        }
      };
      painters.push(paint);
      chip.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest(".ogantt-date-x")) return; // handled below
        this.openRangePicker(chip, state, which, repaint, save);
      });
      x.addEventListener("click", (e) => {
        e.stopPropagation();
        state[which] = "";
        repaint();
        void save();
      });
    };

    makeChip("start");
    makeChip("end");

    // time-of-day for start & end: manual typing at 1-minute precision, the clock icon opens
    // hour + minute (10-min steps) dropdowns (Chromium's native picker ignores `step`)
    const trow = meta.createDiv({ cls: "ogantt-detail-row" });
    trow.createSpan({ cls: "ogantt-detail-label", text: tr().fieldTime });
    const tfield = trow.createDiv({ cls: "ogantt-detail-field ogantt-time-inputs" });
    const makeTime = (which: "start" | "end"): void => {
      const wrap = tfield.createDiv({ cls: "ogantt-time-wrap" });
      const inp = wrap.createEl("input", { cls: "ogantt-time-input", type: "time" });
      const btn = wrap.createEl("button", { cls: "clickable-icon ogantt-time-btn", attr: { "data-focus": `time-${which}` } });
      setIcon(btn, "clock");
      btn.setAttr("aria-label", tr().fieldTime);
      const paint = () => {
        inp.value = times[which];
        const dis = !state[which] || (which === "start" && t.milestone);
        inp.disabled = dis;
        btn.disabled = dis;
      };
      painters.push(paint);
      const apply = (v: string) => {
        times[which] = v;
        // if start > end on the same day, always clamp end = start (never move the start)
        if (state.start && state.start === state.end && times.start && times.end && times.end < times.start) {
          times.end = times.start;
        }
        repaint(); // refresh the time shown on the chips
        void save();
      };
      inp.addEventListener("change", () => apply(inp.value)); // manual entry: any minute
      btn.addEventListener("click", () => this.openTimeDropdown(btn, times[which], apply));
    };
    makeTime("start");
    makeTime("end");

    // duration in workdays: changing it keeps the start and moves the due date (from today when there's no start)
    const cal = scheduleOptions(this.plugin.settings).cal;
    const drow = meta.createDiv({ cls: "ogantt-detail-row" });
    drow.createSpan({ cls: "ogantt-detail-label", text: tr().colDuration });
    const dfield = drow.createDiv({ cls: "ogantt-detail-field" });
    const dinp = dfield.createEl("input", { cls: "ogantt-duration-input", type: "number" });
    dinp.min = "1";
    dinp.step = "1";
    dinp.setAttr("aria-label", tr().colDuration);
    dfield.createSpan({ cls: "ogantt-duration-unit", text: tr().workdaysUnit });
    painters.push(() => {
      const d = t.milestone ? undefined : taskDuration({ start: state.start || undefined, end: state.end || undefined, milestone: false }, cal);
      dinp.value = d != null ? String(d) : "";
      dinp.disabled = t.milestone;
    });
    dinp.addEventListener("change", () => {
      const n = parseDuration(dinp.value);
      if (n == null) {
        repaint(); // revert anything but a whole number ≥ 1
        return;
      }
      state.start = state.start || dayToStr(this.today());
      state.end = dayToStr(endForDuration(dayIndex(state.start), n, cal));
      repaint();
      void save();
    });
    repaint();
  }

  // clock-icon popup: pick a time with hour + minute (10-min steps) dropdowns; × clears the time
  private openTimeDropdown(anchor: HTMLElement, current: string, apply: (v: string) => void): void {
    const pad = (n: number): string => String(n).padStart(2, "0");
    openPopover(anchor, "ogantt-timepick", (pop, close) => {
      const set = /^\d{2}:\d{2}$/.test(current);
      const [ch, cm] = set ? current.split(":") : ["", "00"];
      const hourSel = pop.createEl("select", { cls: "dropdown", attr: { "aria-label": tr().fieldTime } });
      // with no time yet the hour starts at "--", so picking 09 still counts as a change
      if (!set) hourSel.createEl("option", { value: "", text: "--" });
      for (let h = 0; h < 24; h++) hourSel.createEl("option", { value: pad(h), text: pad(h) });
      hourSel.value = ch;
      pop.createSpan({ text: ":" });
      const minSel = pop.createEl("select", { cls: "dropdown", attr: { "aria-label": tr().fieldTime } });
      for (let m = 0; m < 60; m += 10) minSel.createEl("option", { value: pad(m), text: pad(m) });
      // keep an off-grid minute (manual entry) selectable
      if (!minSel.querySelector(`option[value="${cm}"]`)) minSel.createEl("option", { value: cm, text: cm });
      minSel.value = cm;
      const onPick = () => { if (hourSel.value) apply(`${hourSel.value}:${minSel.value}`); };
      hourSel.addEventListener("change", onPick);
      minSel.addEventListener("change", onPick);
      const clr = pop.createEl("button", { cls: "clickable-icon" });
      setIcon(clr, "x");
      clr.setAttr("aria-label", tr().clearDate);
      clr.onclick = () => { apply(""); close(); };
    });
  }

  // paint a non-name cell and, unless it's read-only, attach the double-click editor
  private renderCell(td: HTMLElement, row: Row, col: CellColumn): void {
    if (col.paint(this.board, td, row) === false) return;
    td.dataset.label = col.label(); // names the in-cell editor
    td.dataset.focus = `${row.task!.path}|${col.id}`; // lets a popover return focus to the cell after a redraw
    this.makeEditableCell(td, col.editAria(), (cell) => col.edit(this.board, cell, row));
  }

  // the surface handed to parts like column defs (never the whole view)
  private boardCtx: BoardContext | null = null;
  private get board(): BoardContext {
    if (!this.boardCtx) {
      const settings = () => this.plugin.settings;
      const rollup = () => this.rollup;
      const groupBy = () => this.groupBy;
      this.boardCtx = {
        app: this.app,
        get settings() { return settings(); },
        get rollup() { return rollup(); },
        get groupBy() { return groupBy(); },
        mutate: (label, paths, fn) => this.mutate(label, paths, fn),
        reschedule: (path, next, times) => this.reschedule(path, next, times),
        refresh: () => this.refresh(),
        inlineInput: (cell, value, repaint, commit, configure) => this.inlineInput(cell, value, repaint, commit, configure),
        openRangePicker: (anchor, state, active, repaint, save, single) => this.openRangePicker(anchor, state, active, repaint, save, single),
        chipList: (host, path, field, changed) => this.chipList(host, () => path, field, changed),
        paintTagChip: (chip, tag) => this.paintTagChip(chip, tag),
        openTagMenu: (e, tag) => this.openStyleMenu(e, "tag", tag),
        avatar: (parent, who) => this.avatar(parent, who),
      };
    }
    return this.boardCtx;
  }

  // ----- in-cell editing -----
  // Policy: every column the table can show is editable in place via double-click.
  // Columns are ColumnDefs in src/columns.ts, where paint and edit are both required, so a renderer never ships without its editor.
  private makeEditableCell(cell: HTMLElement, aria: string, edit: (cell: HTMLElement) => void): void {
    cell.addClass("ogantt-td-editable");
    cell.setAttr("aria-label", aria);
    // a single click just selects the row, without opening the panel (double-click edits); clicks in an open editor or on a link pass through
    cell.addEventListener("click", (e) => {
      e.stopPropagation();
      if ((e.target as HTMLElement).closest("input, select, textarea, button, a")) return;
      const tr = cell.closest<HTMLElement>(".ogantt-tr");
      if (tr) this.focusRow(Number(tr.dataset.index));
    });
    cell.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      edit(cell);
    });
  }

  // swap a cell for an input: Enter/blur saves, Esc cancels, an unchanged value is never written
  private inlineInput(
    cell: HTMLElement,
    value: string,
    repaint: () => void,
    commit: (v: string) => Promise<void>,
    configure?: (inp: HTMLInputElement) => void
  ): void {
    if (cell.querySelector("input, select")) return; // already editing
    cell.empty();
    const inp = cell.createEl("input", { type: "text", cls: "ogantt-cell-input", attr: { "aria-label": cell.dataset.label ?? tr().fieldName, dir: "auto" } });
    inp.value = value;
    configure?.(inp);
    inp.focus();
    inp.select();
    // run exactly once (Enter is followed by blur)
    let settled = false;
    const cancel = (): void => {
      if (settled) return;
      settled = true;
      inp.dataset.done = "1"; // a finished edit doesn't hold the board's reload
      repaint();
    };
    const save = (): void => {
      if (inp.validity.badInput) return cancel(); // unreadable number input is never saved as a clear
      if (settled) return;
      settled = true;
      inp.dataset.done = "1";
      const v = inp.value.trim();
      if (v === value.trim()) {
        repaint(); // nothing changed, skip the write
        return;
      }
      // when the write changed nothing (the same value, …) no redraw follows, so the editor closes itself
      void commit(v).finally(() => { if (inp.isConnected) repaint(); });
    };
    inp.addEventListener("keydown", (e) => {
      if (composing(e) || (e.key !== "Enter" && e.key !== "Escape")) return;
      e.preventDefault();
      const row = cell.closest<HTMLElement>(".ogantt-tr");
      if (e.key === "Enter") save();
      else cancel();
      // finishing from the keyboard returns to the row, so the arrow keys keep working
      if (row?.isConnected && !cell.contains(activeDocument.activeElement)) row.focus({ preventScroll: true });
    });
    inp.addEventListener("blur", save);
  }

  // attach a datalist to an input; `fill` supplies the options
  private attachSuggestions(inp: HTMLInputElement, fill: (list: HTMLDataListElement) => void): HTMLDataListElement {
    // a counter keeps ids unique across concurrent editors
    const id = `ogantt-suggest-${++this.cellEditSeq}`;
    const list = (inp.parentElement ?? inp).createEl("datalist");
    list.id = id;
    inp.setAttr("list", id);
    fill(list);
    return list;
  }

  // suggest the vault's existing tags for a single-tag input (the detail panel's add field)
  // it scans the whole vault, so the list is gathered on the field's first focus and reused until the next refresh
  private attachSingleTagSuggestions(inp: HTMLInputElement, exclude: string[] = []): void {
    inp.addEventListener("focus", () => {
      const all = (this.tagCache ??= collectAllTags(this.app)).filter((x) => !exclude.includes(x));
      if (all.length) this.attachSuggestions(inp, (list) => all.forEach((tag) => list.createEl("option", { value: tag })));
    }, { once: true });
  }

  // range calendar: pick start & end in one popup; month nav ← →, theme-aware
  private openRangePicker(
    anchor: HTMLElement,
    state: { start: string; end: string },
    active: "start" | "end",
    repaint: () => void,
    save: () => void | Promise<void>,
    // single-date mode when given: a pick sets start = end to that day and closes; the value names the field
    single?: string
  ): void {
    openPopover(anchor, "ogantt-cal", (cal, close) => {
      const todayStr = dayToStr(this.today());
      const base = state[active] || state.start || state.end || todayStr;
      let y = parseInt(base.slice(0, 4), 10);
      let m = parseInt(base.slice(5, 7), 10); // 1-based
      let act = active; // endpoint the next click sets
      // the week starts with the first workday (Sunday after a Friday and Saturday off, Monday after Saturday and Sunday); weekday names in the UI language
      const work = scheduleOptions(this.plugin.settings).cal;
      const firstDay = weekStart(work);
      const wk = [...moment.weekdaysMin().slice(firstDay), ...moment.weekdaysMin().slice(0, firstDay)];
      const monthTitle = dateFormat({ year: "numeric", month: "long" }); // the UI language's month title

      let mode: "day" | "year" = "day"; // day view or year (12-month) view
      const months = moment.monthsShort(); // localized short month names

      // set one endpoint, then alternate; on inversion always clamp end = start (never move the start)
      const pick = (ds: string) => {
        if (single !== undefined) {
          state.start = state.end = ds;
          repaint();
          void save();
          close();
          return;
        }
        if (act === "start") {
          state.start = ds;
          if (state.end && ds > state.end) state.end = ds; // end follows forward
          act = "end";
        } else {
          // picking before the start clamps end to the start
          state.end = state.start && ds < state.start ? state.start : ds;
          act = "start";
        }
        repaint();
        void save();
        render();
      };

      // day view
      const renderDay = () => {
        const head = cal.createDiv({ cls: "ogantt-cal-head" });
        const prev = head.createEl("button", { cls: "clickable-icon", attr: { "aria-label": tr().previous } });
        setIcon(prev, "chevron-left");
        prev.onclick = () => { if (--m < 1) { m = 12; y--; } render(); };
        // click the title to open the year view
        const title = head.createEl("button", { cls: "ogantt-cal-title", text: monthTitle.format(Date.UTC(y, m - 1, 1)) });
        title.onclick = () => { mode = "year"; render(); };
        const next = head.createEl("button", { cls: "clickable-icon", attr: { "aria-label": tr().next } });
        setIcon(next, "chevron-right");
        next.onclick = () => { if (++m > 12) { m = 1; y++; } render(); };

        cal.createDiv({ cls: "ogantt-cal-active", text: `▸ ${single ?? (act === "start" ? tr().fieldStart : tr().fieldDue)}` });

        const wkRow = cal.createDiv({ cls: "ogantt-cal-wk" });
        wk.forEach((w) => wkRow.createSpan({ text: w }));

        const grid = cal.createDiv({ cls: "ogantt-cal-grid" });
        const firstDow = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() - firstDay + 7) % 7; // blanks before the 1st
        const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
        for (let i = 0; i < firstDow; i++) grid.createSpan({ cls: "ogantt-cal-pad" });
        for (let d = 1; d <= dim; d++) {
          const ds = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          const cell = grid.createEl("button", { cls: "ogantt-cal-day", text: String(d) });
          if (ds === todayStr) cell.addClass("is-today");
          if (!isWorkday(dayIndex(ds), work)) cell.addClass("is-off"); // days off are quieter
          if (ds === state.start) cell.addClass("is-range-start");
          if (ds === state.end) cell.addClass("is-range-end");
          if (state.start && state.end && ds > state.start && ds < state.end) cell.addClass("is-in-range");
          cell.onclick = () => pick(ds);
        }

        const foot = cal.createDiv({ cls: "ogantt-cal-foot" });
        const todayBtn = foot.createEl("button", { text: tr().today });
        todayBtn.onclick = () => {
          y = parseInt(todayStr.slice(0, 4), 10);
          m = parseInt(todayStr.slice(5, 7), 10); // move the view to today
          pick(todayStr);
        };
        const clearBtn = foot.createEl("button", { text: tr().clearDate });
        clearBtn.onclick = () => {
          if (single !== undefined) {
            state.start = state.end = "";
            repaint();
            void save();
            close();
            return;
          }
          state[act] = "";
          repaint();
          void save();
          render();
        };
      };

      // year view (12 months)
      const renderYear = () => {
        const head = cal.createDiv({ cls: "ogantt-cal-head" });
        const prev = head.createEl("button", { cls: "clickable-icon", attr: { "aria-label": tr().previous } });
        setIcon(prev, "chevron-left");
        prev.onclick = () => { y--; render(); }; // year nav
        head.createSpan({ cls: "ogantt-cal-title", text: `${y}` });
        const next = head.createEl("button", { cls: "clickable-icon", attr: { "aria-label": tr().next } });
        setIcon(next, "chevron-right");
        next.onclick = () => { y++; render(); };

        const grid = cal.createDiv({ cls: "ogantt-cal-months" });
        for (let mm = 1; mm <= 12; mm++) {
          const cell = grid.createEl("button", { cls: "ogantt-cal-month", text: months[mm - 1] });
          if (mm === m) cell.addClass("is-current");
          const ym = `${y}-${String(mm).padStart(2, "0")}`;
          if (state.start.startsWith(ym) || state.end.startsWith(ym)) cell.addClass("is-selected"); // months holding an endpoint
          cell.onclick = () => { m = mm; mode = "day"; render(); };
        }
      };

      // keep the keyboard's place across a rebuild: back to the button of the same name
      const render = () => {
        const was = cal.ownerDocument.activeElement;
        const name = was && cal.contains(was) ? was.getAttribute("aria-label") ?? was.textContent : null;
        cal.empty();
        if (mode === "year") renderYear();
        else renderDay();
        if (name != null) (Array.from(cal.querySelectorAll<HTMLElement>("button")).find((b) => (b.getAttribute("aria-label") ?? b.textContent) === name) ?? cal.querySelector<HTMLElement>("button"))?.focus();
      };
      render();
    });
  }

  // drag to resize the detail panel (width persisted)
  private attachResize(resizer: HTMLElement, panel: HTMLElement): void {
    resizer.addEventListener("pointerdown", (ev: PointerEvent) => {
      ev.preventDefault();
      resizer.setPointerCapture(ev.pointerId);
      const board = this.contentEl.getBoundingClientRect();
      const onMove = (e: PointerEvent) => {
        const w = Math.max(280, Math.min(board.width - 320, board.right - e.clientX)); // leave the board 320px
        panel.style.width = `${w}px`;
      };
      const onUp = () => void (async () => {
        resizer.releasePointerCapture(ev.pointerId);
        resizer.removeEventListener("pointermove", onMove);
        resizer.removeEventListener("pointerup", onUp);
        this.plugin.settings.detailWidth = parseInt(panel.style.width, 10) || 380;
        await this.plugin.saveData(this.plugin.settings);
      })();
      resizer.addEventListener("pointermove", onMove);
      resizer.addEventListener("pointerup", onUp);
    });
  }

  // the bar hover card (name, dates, duration, status, progress, assignees); mouse only, shown after a short pause
  private showCard(t: Task, e: PointerEvent): void {
    if (e.pointerType !== "mouse" || this.dragPath) return;
    this.moveCard(e);
    if (this.card.timer != null) window.clearTimeout(this.card.timer);
    this.card.timer = window.setTimeout(() => {
      this.card.timer = null;
      const doc = this.contentEl.ownerDocument;
      if (this.card.el?.ownerDocument !== doc) {
        this.card.el?.remove();
        this.card.el = doc.body.createDiv({ cls: "ogantt-card" });
      }
      const card = this.card.el;
      const s = this.plugin.settings;
      card.empty();
      card.createDiv({ cls: "ogantt-card-title", text: t.name });
      const line = (label: string, value: string) => {
        const r = card.createDiv({ cls: "ogantt-card-row" });
        r.createSpan({ cls: "ogantt-card-label", text: label });
        r.createSpan({ text: value });
      };
      const start = anchorStart(t);
      const end = anchorEnd(t);
      if (start || end) line(tr().fieldDates, start && end && start !== end ? `${formatDate(start, s.dateFormat)} → ${formatDate(end, s.dateFormat)}` : formatDate((start ?? end)!, s.dateFormat));
      const days = t.milestone ? undefined : taskDuration(t, scheduleOptions(s).cal);
      if (days != null) line(tr().colDuration, tr().durationDays(days));
      const st = s.statuses.find((x) => x.id === t.status);
      if (st) line(tr().fieldStatus, st.label);
      const pct = progressPct(t);
      if (t.cards) line(tr().fieldProgress, `${pct ?? 0}% · ${tr().kanbanProgress(t.cards.done, t.cards.total)}`);
      else if (pct != null) line(tr().fieldProgress, `${pct}%`);
      if (t.assignees.length) line(tr().fieldAssignee, t.assignees.map(linkLabel).join(", "));
      if (t.tags.length) line(tr().fieldTags, t.tags.join(", "));
      card.addClass("is-visible");
      this.placeCard();
    }, 300);
  }

  private moveCard(e: PointerEvent): void {
    this.card.x = e.clientX;
    this.card.y = e.clientY;
    if (this.card.el?.hasClass("is-visible")) this.placeCard();
  }

  // place it below-right of the cursor, flipping left or up at the window edge
  private placeCard(): void {
    const card = this.card.el;
    if (!card) return;
    const win = card.ownerDocument.defaultView ?? window;
    const { x, y } = this.card;
    card.style.left = `${x + 14 + card.offsetWidth > win.innerWidth ? x - card.offsetWidth - 10 : x + 14}px`;
    card.style.top = `${y + 18 + card.offsetHeight > win.innerHeight ? y - card.offsetHeight - 10 : y + 18}px`;
  }

  private hideCard(): void {
    if (this.card.timer != null) window.clearTimeout(this.card.timer);
    this.card.timer = null;
    this.card.el?.removeClass("is-visible");
  }

  // ----- export as PNG -----
  // draws the whole board, off-screen rows included (name column, date axis, bars, arrows, colour key), into one SVG, turns it into a PNG on
  // a canvas and saves it where the vault keeps attachments. Bars and arrows use the screen's own drawing code and CSS, so the look
  // (theme colours, the Display menu's switches) carries over
  async exportPng(): Promise<void> {
    if (this.layout !== "timeline") return void new Notice(tr().exportTimelineOnly); // the export draws the timeline
    // while the board shows its empty state there is nothing to export: say so
    if (!this.boardMain) return void new Notice(this.tasks.length ? tr().noMatches : tr().emptyMessage(this.folder || tr().vaultRoot));
    if (this.exporting) return; // one export at a time
    this.exporting = true;
    // named up front, so switching boards mid-export can't rename it
    const name = `Gantt ${this.folder.split("/").pop() || tr().vaultRoot} ${dayToStr(this.today())}.png`;
    try {
      const blob = await this.rasterise(this.exportSvg());
      // where the vault keeps attachments; "/" makes a relative setting resolve from the vault root rather than from some note
      const path = await this.app.fileManager.getAvailablePathForAttachment(name, "/");
      const file = await this.app.vault.createBinary(path, await blob.arrayBuffer());
      this.buttonNotice(tr().exportDone(file.path), tr().exportOpen, () => void this.app.workspace.getLeaf("tab").openFile(file), 8000);
    } catch (e) {
      console.error(e);
      new Notice(tr().exportFailed);
    } finally {
      this.exporting = false;
    }
  }

  // the SVG to export: the whole board (off-screen rows too), name column, date axis and colour key. Bars and arrows use the screen's own
  // drawing code and CSS. Text uses a system font that also exists inside an SVG image, and is measured in it (the page's web fonts don't)
  private exportSvg(): SVGSVGElement {
    const screenFont = this.fontFamily;
    this.fontFamily = EXPORT_FONT;
    this.bare = true;
    // the export covers the tasks' range only (not the days added by scrolling)
    const shown = this.range;
    this.range = this.baseRange;
    try {
      const PAD = 16;
      const TITLE_H = 34;
      const NAME_W = Math.max(200, this.colW("name"));
      const width = (this.range.max - this.range.min + 1) * this.ppd;
      const bodyH = this.rows.length * ROW_H;
      const svg = this.svgEl("svg", { "font-family": EXPORT_FONT });
      const bg = svg.appendChild(this.svgEl("rect", { class: "x-bg" }));
      const text = (parent: SVGElement, x: number, y: number, cls: string, value: string) => {
        parent.appendChild(this.svgEl("text", { x, y, class: cls })).textContent = value;
      };
      text(svg, PAD, PAD + 20, "x-title", `${isolate(this.folder || tr().vaultRoot)} — ${formatDate(dayToStr(this.today()), this.plugin.settings.dateFormat)}`);
      const top = PAD + TITLE_H;
      // the date axis
      const zoom = this.tickZoom();
      const { ticks, bands } = this.axisMarks(zoom);
      const axis = svg.appendChild(this.svgEl("g", { transform: `translate(${PAD + NAME_W},${top})` }));
      for (const b of bands) text(axis, b.x + 4, 14, "x-band", b.label);
      for (const tk of ticks) {
        axis.appendChild(this.svgEl("line", { x1: tk.x, y1: HEAD_H / 2, x2: tk.x, y2: HEAD_H, class: "x-line" }));
        text(axis, tk.x + 3, HEAD_H - 7, tk.major ? "x-tick is-major" : "x-tick", tk.label);
      }
      // rows: heading backgrounds in the name column, separators, names (clipped to the column)
      const body = svg.appendChild(this.svgEl("g", { transform: `translate(${PAD},${top + HEAD_H})` }));
      this.defs(svg).appendChild(this.svgEl("clipPath", { id: "x-names" })).appendChild(this.svgEl("rect", { width: NAME_W - 8, height: bodyH }));
      const names = this.svgEl("g", { "clip-path": "url(#x-names)" });
      this.rows.forEach((row, i) => {
        const y = i * ROW_H;
        if (row.kind === "group") body.appendChild(this.svgEl("rect", { y, width: NAME_W, height: ROW_H, class: "ogantt-grid-group" }));
        body.appendChild(this.svgEl("line", { x1: 0, y1: y + ROW_H - 0.5, x2: NAME_W + width, y2: y + ROW_H - 0.5, class: "x-line" }));
        // names sit where they do on screen (a task after its chevron slot); since no name follows the bar, a completed task's ✓ fills that slot and a cancelled one is struck through here
        const x = this.indentOf(row);
        const cy = y + ROW_H / 2 + 4;
        if (row.kind === "group") text(names, x, cy, "x-name is-group", isolate(row.group));
        else {
          const st = statusGroupOf(this.plugin.settings.statuses, row.task!.status);
          if (st === "completed") text(names, x, cy, "x-name", "✓");
          text(names, x + 16, cy, st === "cancelled" ? "x-name is-cancelled" : "x-name", isolate(row.task!.name));
        }
      });
      body.appendChild(names);
      // the timeline: non-working days, heading backgrounds, today, bars, arrows (stacked as on screen)
      const tl = svg.appendChild(this.svgEl("g", { transform: `translate(${PAD + NAME_W},${top + HEAD_H})` }));
      tl.appendChild(this.svgEl("line", { x1: 0, y1: -HEAD_H, x2: 0, y2: bodyH, class: "x-line" }));
      if (zoom !== "Month") {
        const cal = scheduleOptions(this.plugin.settings).cal;
        for (let d = this.range.min; d <= this.range.max; d++) {
          if (!isWorkday(d, cal)) tl.appendChild(this.svgEl("rect", { x: this.dayX(d), width: this.ppd, height: bodyH, class: "x-off" }));
        }
      }
      const groupBg = tl.appendChild(this.svgEl("g", {}));
      this.drawToday(tl, width, bodyH);
      this.drawCopyLinks(tl);
      const depLayer = tl.appendChild(this.svgEl("g", {}));
      const barLayer = tl.appendChild(this.svgEl("g", {}));
      if (this.progressLine) this.drawProgressLine(tl, width, bodyH);
      const fill = this.barFill(svg);
      this.rows.forEach((row, i) => {
        if (row.kind === "group") this.drawGroupRow(groupBg, barLayer, row, i, width);
        else this.drawBar(barLayer, svg, row, i, fill, null);
      });
      if (this.showDeps) for (const dep of this.depRows()) this.drawDep(depLayer, dep);
      // labels and tags can run past the timeline's end, so measure what was drawn to size the image. The embedded CSS stays out while
      // measuring (the page already has the same CSS, and inserting it would restyle the whole app)
      const doc = this.contentEl.ownerDocument;
      svg.setAttribute("style", "position: fixed; left: -100000px; top: 0; visibility: hidden");
      doc.body.appendChild(svg);
      const box = tl.getBBox();
      svg.remove();
      svg.removeAttribute("style");
      const W = PAD * 2 + NAME_W + Math.max(width, Math.ceil(box.x + box.width));
      // the colour key wraps to the image's width
      const keyTitle = this.colorBy === "status" ? tr().fieldStatus : tr().fieldAssignee;
      let kx = this.textWidth(keyTitle, KEY_PX, 600) + 14;
      let ky = 0;
      const key = this.colorKey().map(({ color, label }) => {
        const w = 32 + this.textWidth(label, KEY_PX);
        if (kx + w > W - PAD * 2) {
          kx = 0;
          ky += 20;
        }
        const at = { color, label, x: kx, y: ky };
        kx += w;
        return at;
      });
      const H = PAD * 2 + TITLE_H + HEAD_H + bodyH + (key.length ? ky + 40 : 0);
      for (const el of [svg, bg]) {
        el.setAttribute("width", String(W));
        el.setAttribute("height", String(H));
      }
      if (key.length) {
        const g = svg.appendChild(this.svgEl("g", { transform: `translate(${PAD},${top + HEAD_H + bodyH + 24})` }));
        text(g, 0, 4, "x-key is-title", keyTitle);
        for (const k of key) {
          g.appendChild(this.svgEl("rect", { x: k.x, y: k.y - 6, width: 11, height: 11, rx: 3, fill: k.color }));
          text(g, k.x + 16, k.y + 4, "x-key", isolate(k.label));
        }
      }
      svg.insertBefore(this.svgEl("style", {}), svg.firstChild).textContent = this.exportCss();
      return svg;
    } finally {
      this.fontFamily = screenFont;
      this.bare = false;
      this.range = shown;
    }
  }

  // turns the SVG into a PNG, scaled to fit the canvas limits (per side and in area; much smaller on phones)
  // ponytail: a very large board comes out below 1x; filter or collapse groups first for a sharper image
  private async rasterise(svg: SVGSVGElement): Promise<Blob> {
    const W = Number(svg.getAttribute("width"));
    const H = Number(svg.getAttribute("height"));
    // XML-invalid control characters (possible in file names) would break the image, so drop them
    const xml = new XMLSerializer().serializeToString(svg).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "");
    const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml" }));
    const canvas = createEl("canvas");
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const scale = Math.min(2, 16384 / W, 16384 / H, Math.sqrt((Platform.isMobile ? 16e6 : 3e7) / (W * H)));
      canvas.width = Math.round(W * scale);
      canvas.height = Math.round(H * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2D canvas");
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, W, H);
      const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/png"));
      if (!blob) throw new Error("the canvas gave no PNG");
      return blob;
    } finally {
      URL.revokeObjectURL(url);
      canvas.width = canvas.height = 0; // release the big canvas right away
    }
  }

  // the CSS embedded in the exported SVG: this plugin's rules plus the current values of the CSS variables they use (the theme's colours)
  private exportCss(): string {
    const rules = [
      ".x-bg { fill: var(--background-primary); }",
      ".x-title { font-size: 15px; font-weight: 600; fill: var(--text-normal); }",
      ".x-name { font-size: 12px; fill: var(--text-normal); }",
      ".x-name.is-group, .x-key.is-title, .x-tick.is-major, .x-band { font-weight: 600; fill: var(--text-normal); }",
      ".x-name.is-cancelled { text-decoration: line-through; opacity: 0.55; }",
      ".x-line { stroke: var(--background-modifier-border-hover); }",
      ".x-tick, .x-band { font-size: 10px; }",
      ".x-tick { fill: var(--text-muted); }",
      ".x-off { fill: var(--ogantt-offday); }",
      `.x-key { font-size: ${KEY_PX}px; fill: var(--text-muted); }`,
    ];
    // only the .ogantt- rules, from this view's own document (its own window when popped out); each window has its own types, so no instanceof
    for (const sheet of Array.from(this.contentEl.ownerDocument.styleSheets)) {
      try {
        for (const r of Array.from(sheet.cssRules)) if ((r as Partial<CSSStyleRule>).selectorText?.includes(".ogantt-")) rules.push(r.cssText);
      } catch {
        // skip a sheet that can't be read (another origin)
      }
    }
    const css = rules.join("\n");
    const cs = getComputedStyle(this.contentEl);
    const vars = [...new Set(css.match(/--[\w-]+/g) ?? [])].map((v) => `${v}: ${cs.getPropertyValue(v).trim() || "initial"};`).join(" ");
    return `svg { ${vars} }\n${css}`;
  }

  // SVG element helper (uses Obsidian's createSvg)
  private svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
    const el = createSvg(tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
  }
}
