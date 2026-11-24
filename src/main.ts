import { Plugin, WorkspaceLeaf, TFolder, TFile, Menu, TAbstractFile, normalizePath } from "obsidian";
import { GanttSettings, DEFAULT_SETTINGS, GanttSettingTab } from "./settings";
import { GanttView } from "./view";
import { VIEW_TYPE_GANTT, GanttViewState } from "./types";
import { t } from "./i18n";
import { collectTasks, inferStatusGroup, movePaths } from "./model";
import { keepAutoFired, migrateAutoFired, migrateWeekend, moveAutoFired } from "./schedule";
import { checkNotifications } from "./notify";
import { usePopoverKeys } from "./popover";
import { migrateRenamedPath, schedulePush, syncGcal } from "./gcal/sync";
import { isConnected } from "./gcal/auth";
import { migrateLegacySecrets } from "./gcal/secrets";
import { AiView, VIEW_TYPE_AI } from "./ai-view";

export default class GanttPlugin extends Plugin {
  settings!: GanttSettings;
  // the settings tab, held so a table-side color edit can refresh it while it's open
  settingTab?: GanttSettingTab;
  private lastNotifyCheck = 0; // last notification check (epoch ms)
  private lastGcalPull = 0; // last Google Calendar pull (epoch ms)
  private recentBoard: GanttView | null = null; // the board used last (the plan assistant talks about it)

  async onload(): Promise<void> {
    await this.loadSettings();
    usePopoverKeys(this.app); // popovers take Esc before, say, the settings window

    this.registerView(VIEW_TYPE_GANTT, (leaf) => new GanttView(leaf, this));
    this.registerView(VIEW_TYPE_AI, (leaf) => new AiView(leaf, this));
    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
      if (leaf?.view instanceof GanttView) this.recentBoard = leaf.view;
    }));
    this.addCommand({ id: "open-ai", name: t().aiOpen, callback: () => void this.openAi() });
    // Page preview for links in the body and assignee
    this.registerHoverLinkSource(VIEW_TYPE_GANTT, { display: "Task Gantt", defaultMod: true });

    // ribbon opens the focused folder
    this.addRibbonIcon("gantt-chart", t().ribbonOpen, () => {
      void this.activateView(this.currentFolder());
    });

    this.addCommand({
      id: "open-gantt",
      name: t().commandOpen,
      callback: () => void this.activateView(this.currentFolder()),
    });

    // commands for the board in front (only while one is): export as PNG, and reload (moved from the toolbar to the "⋯" menu, so it can take a hotkey too)
    const boardCommand = (id: string, name: string, run: (view: GanttView) => void) => this.addCommand({ id, name, checkCallback: (checking) => {
      const view = this.app.workspace.getActiveViewOfType(GanttView);
      if (view && !checking) run(view);
      return !!view;
    } });
    boardCommand("status-report", `${t().reportTitle}…`, (view) => view.openReport());
    boardCommand("export-work-plan", t().workPlanExport, (view) => view.exportWorkPlan());
    boardCommand("export-png", t().exportPng, (view) => void view.exportPng());
    boardCommand("reload-board", t().reloadAria, (view) => void view.refresh());

    // folder context menu
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
        if (file instanceof TFolder) {
          menu.addItem((item) =>
            item
              .setTitle(t().menuOpen)
              .setIcon("gantt-chart")
              .onClick(() => void this.activateView(file.path))
          );
        }
      })
    );

    // kept so table-side color edits can refresh it
    this.settingTab = new GanttSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);

    this.addCommand({
      id: "gcal-sync-now",
      name: `${t().setGcalHeading}: ${t().setGcalSyncNow}`,
      callback: () => void syncGcal(this, { pull: true }),
    });

    // debounce local edits into a push (scope and diffing are handled by the sync engine)
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        if (file.extension === "md") schedulePush(this);
      })
    );
    // renames re-key the sync state; a folder rename carries its boards' view setup along, and collapsed parent tasks follow on closed boards too
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile) migrateRenamedPath(this, oldPath, file.path);
        if (file instanceof TFile || file instanceof TFolder) this.moveBoards(oldPath, file.path);
      })
    );
    // deletions schedule the orphan cleanup
    this.registerEvent(
      this.app.vault.on("delete", () => schedulePush(this))
    );

    // notification scheduler: every minute, send triggers that arrived since the last check.
    // triggers missed while Obsidian was closed are skipped (no burst on startup).
    this.app.workspace.onLayoutReady(() => {
      this.lastNotifyCheck = Date.now();
      this.registerInterval(
        window.setInterval(() => {
          const now = Date.now();
          // after a sleep, alerts older than two minutes aren't sent in a burst
          const from = Math.max(this.lastNotifyCheck, now - 120_000);
          this.lastNotifyCheck = now;
          void checkNotifications(this, from, now);
          // Google Calendar: pull at the configured interval, push sweeps every minute (no-op without changes)
          const g = this.settings.gcal;
          if (g.calendarId && isConnected(this)) {
            const pull = g.pullEnabled && now - this.lastGcalPull >= g.pullIntervalMin * 60_000;
            if (pull) this.lastGcalPull = now;
            void syncGcal(this, { pull });
          }
        }, 60_000)
      );
    });
  }

  // re-key the "folder:<path>" board setups of a renamed folder and its subfolders, and let collapsed parent tasks (paths) follow on every board
  private moveBoards(from: string, to: string): void {
    const boards = this.settings.boards;
    let moved = false;
    // the default folder follows too (left on the old name, automatic status silently stops)
    const root = this.settings.rootFolder ?? "";
    if (root && (root === from || root.startsWith(from + "/"))) {
      this.settings.rootFolder = to + root.slice(from.length);
      moved = true;
    }
    for (const key of Object.keys(boards)) {
      const b = boards[key];
      // the manual order, disabled tasks and opened parents (keyed by path)
      const order = movePaths(b.order ?? [], from, to);
      const disabled = movePaths(b.disabled ?? [], from, to);
      const expanded = movePaths(b.expanded ?? [], from, to);
      if (order.some((k, i) => k !== b.order?.[i]) || disabled.some((k, i) => k !== b.disabled?.[i]) || expanded.some((k, i) => k !== b.expanded?.[i])) {
        boards[key] = { ...b, order, disabled, expanded };
        moved = true;
      }
      const path = key.startsWith("folder:") ? key.slice(7) : null;
      if (path == null || (path !== from && !path.startsWith(from + "/"))) continue;
      boards[`folder:${to}${path.slice(from.length)}`] = boards[key];
      delete boards[key];
      moved = true;
    }
    // automatic-status records (keyed by note path) follow too
    if (moveAutoFired(this.settings.autoStatus.fired, from, to)) moved = true;
    // folder heading icons ("folder:<path>") follow too
    const icons = this.settings.icons;
    for (const key of Object.keys(icons)) {
      const path = key.startsWith("folder:") ? key.slice(7) : null;
      if (path == null || (path !== from && !path.startsWith(from + "/"))) continue;
      icons[`folder:${to}${path.slice(from.length)}`] = icons[key];
      delete icons[key];
      moved = true;
    }
    if (moved) void this.saveData(this.settings);
  }

  // after a status is renamed, re-key what is remembered by its name: the heading icon and collapsed headings ("status:<name>");
  // a target already in use is left alone. The caller saves
  renameStatusKeys(from: string, to: string): void {
    const a = `status:${from}`;
    const b = `status:${to}`;
    if (a === b) return;
    const { icons, boards } = this.settings;
    if (icons[a] && !icons[b]) {
      icons[b] = icons[a];
      delete icons[a];
    }
    for (const board of Object.values(boards)) {
      if (board.collapsed?.includes(a) && !board.collapsed.includes(b)) board.collapsed = board.collapsed.map((k) => (k === a ? b : k));
    }
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_GANTT)) if (leaf.view instanceof GanttView) leaf.view.renameCollapsed(a, b);
  }

  // best-effort current folder
  private currentFolder(): string {
    // folder selected in the file explorer
    const explorer = this.app.workspace.getLeavesOfType("file-explorer")[0];
    const view = explorer?.view as unknown as { tree?: { focusedItem?: { file?: TAbstractFile } } } | undefined;
    const focused = view?.tree?.focusedItem?.file;
    if (focused instanceof TFolder) return focused.path;
    if (focused instanceof TFile && focused.parent) return focused.parent.path;
    // active note's parent folder
    const af = this.app.workspace.getActiveFile();
    if (af?.parent) return af.parent.path;
    // configured default
    return this.settings.rootFolder ?? "";
  }

  // the board the plan assistant talks about: the one used last while it's still open, else any open board
  lastBoard(): GanttView | undefined {
    const open = this.app.workspace.getLeavesOfType(VIEW_TYPE_GANTT).map((l) => l.view).filter((v): v is GanttView => v instanceof GanttView);
    return open.find((v) => v === this.recentBoard) ?? open[0];
  }

  // the plan assistant in the right sidebar (brought forward when already open)
  async openAi(): Promise<void> {
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_AI)[0] ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: VIEW_TYPE_AI, active: true });
    void this.app.workspace.revealLeaf(leaf);
  }

  // open a folder's board: the tab already showing that folder comes forward, else a new tab opens (other boards stay open)
  async activateView(folderPath: string): Promise<void> {
    const folder = normalizePath(folderPath) === "/" ? "" : normalizePath(folderPath);
    const open = this.app.workspace.getLeavesOfType(VIEW_TYPE_GANTT).find((l) => l.getViewState().state?.folder === folder);
    const leaf = open ?? this.app.workspace.getLeaf("tab");
    if (!open) await leaf.setViewState({ type: VIEW_TYPE_GANTT, active: true, state: { folder, filters: [] } satisfies GanttViewState });
    await this.app.workspace.revealLeaf(leaf);
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
  }

  // after a status id change, the open tabs' filters follow it
  renameStatusInTabs(from: string, to: string): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_GANTT)) if (leaf.view instanceof GanttView) leaf.view.renameStatusFilter(from, to);
  }

  async loadSettings(): Promise<void> {
    // loadData() returns any: cast to the saved shape
    const data = (await this.loadData()) as Partial<GanttSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    this.settings.keys = Object.assign({}, DEFAULT_SETTINGS.keys, this.settings.keys);
    // statuses are mutated in place by the settings tab, so always clone (an unsaved install would
    // otherwise share the DEFAULT array); pre-2.9.0 data has no group, so infer one from id + label
    this.settings.statuses = (this.settings.statuses ?? []).map((s) => ({
      ...s,
      group: s.group ?? inferStatusGroup(s.id ?? "", s.label ?? ""),
    }));
    // clone so we don't mutate the shared DEFAULT containers
    this.settings.tagColors = (this.settings.tagColors ?? []).map((c) => ({ ...c }));
    this.settings.folderColors = (this.settings.folderColors ?? []).map((c) => ({ ...c }));
    this.settings.assigneeColors = (this.settings.assigneeColors ?? []).map((c) => ({ ...c }));
    this.settings.icons = { ...(this.settings.icons ?? {}) };
    this.settings.boards = { ...(this.settings.boards ?? {}) };
    this.settings.columnWidths = { ...(this.settings.columnWidths ?? {}) };
    this.settings.columnOrder = [...(this.settings.columnOrder ?? [])];
    this.settings.autoStatus = Object.assign({}, DEFAULT_SETTINGS.autoStatus, this.settings.autoStatus);
    this.settings.autoStatus.notStarted = [...(this.settings.autoStatus.notStarted ?? [])];
    // records up to 2.15 (and 2.14's undone) carry over as pins, "leave alone while these dates stand", so an upgrade never rewrites a hand-set status
    const legacy = this.settings.autoStatus as { undone?: unknown };
    this.settings.autoStatus.fired = migrateAutoFired(this.settings.autoStatus.fired, legacy.undone);
    delete legacy.undone;
    this.settings.customFields = (this.settings.customFields ?? []).map((f) => ({ ...f }));
    this.settings.filters = structuredClone(this.settings.filters ?? []);
    this.settings.filterPresets = structuredClone(this.settings.filterPresets ?? []);
    this.settings.nonWorkingDays = migrateWeekend([...(this.settings.nonWorkingDays ?? DEFAULT_SETTINGS.nonWorkingDays)], this.settings.weekendMigrated);
    this.settings.weekendMigrated = true;
    // the old default date format moves once to the glance format; a format picked afterwards stays
    if (!this.settings.dateFormatMigrated && this.settings.dateFormat === "YYYY/MM/DD") this.settings.dateFormat = "ddd D MMM";
    this.settings.dateFormatMigrated = true;
    this.settings.ai = Object.assign({}, DEFAULT_SETTINGS.ai, this.settings.ai);
    // merge notify settings with defaults and clone containers
    this.settings.notify = Object.assign({}, DEFAULT_SETTINGS.notify, this.settings.notify);
    this.settings.notify.leads = [...(this.settings.notify.leads ?? [])];
    this.settings.notify.sent = { ...(this.settings.notify.sent ?? {}) };
    // merge Google Calendar settings with defaults and clone containers
    this.settings.gcal = Object.assign({}, DEFAULT_SETTINGS.gcal, this.settings.gcal);
    const st: typeof this.settings.gcal.state = {};
    for (const [p, v] of Object.entries(this.settings.gcal.state ?? {})) st[p] = { ...v };
    this.settings.gcal.state = st;
    // move secrets older versions left in plain text into SecretStorage and scrub data.json (issue #6)
    if (migrateLegacySecrets(this)) await this.saveData(this.settings);
  }

  // save appearance-only settings (colours, statuses, icons, column widths) and redraw every open board and the settings tab, without re-reading tasks
  async saveLook(): Promise<void> {
    await this.saveData(this.settings);
    this.settingTab?.refreshIfOpen();
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_GANTT)) if (leaf.view instanceof GanttView) leaf.view.rerender();
  }

  // settings changed on another device (sync): reload them into open boards and the settings tab, so this window's old copy never overwrites them
  async onExternalSettingsChange(): Promise<void> {
    await this.loadSettings();
    this.settingTab?.refreshIfOpen();
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_GANTT)) if (leaf.view instanceof GanttView) leaf.view.reloadBoard();
  }

  // save and reload the boards; automatic status runs once after the save (waiting while typing goes on), not once per board
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.app.workspace.getLeavesOfType(VIEW_TYPE_GANTT).forEach((leaf: WorkspaceLeaf) => {
      const v = leaf.view;
      if (v instanceof GanttView) void v.refresh();
    });
    if (this.autoTimer != null) window.clearTimeout(this.autoTimer);
    this.autoTimer = window.setTimeout(() => {
      this.autoTimer = null;
      this.requestAutoStatus();
    }, 1000);
  }

  onunload(): void {
    if (this.autoTimer != null) window.clearTimeout(this.autoTimer);
    this.autoTimer = null;
  }

  // ── automatic status by date: one run over everything under the default folder (the whole vault when unset), requested when a board opens, the day
  // changes or settings are saved; a request during a run makes it run once more afterwards. It waits until no board is writing, undoing or dragging.
  // The writes and their undo go into the front board's history
  private autoRun: Promise<void> | null = null;
  private autoAgain = false;
  private autoTimer: number | null = null;
  requestAutoStatus(): void {
    if (!this.settings.autoStatus.enabled) return;
    if (this.autoRun) {
      this.autoAgain = true;
      return;
    }
    this.autoRun = this.autoStatusRuns().finally(() => (this.autoRun = null));
  }

  private async autoStatusRuns(): Promise<void> {
    do {
      this.autoAgain = false;
      const views = () => this.app.workspace.getLeavesOfType(VIEW_TYPE_GANTT).map((l) => l.view).filter((v): v is GanttView => v instanceof GanttView);
      while (views().some((v) => v.isBusy())) await new Promise((r) => window.setTimeout(r, 300));
      const view = this.app.workspace.getActiveViewOfType(GanttView) ?? views()[0];
      if (!view || !this.settings.autoStatus.enabled) return;
      const tasks = collectTasks(this.app, { ...this.settings, recurse: true }, this.settings.rootFolder ?? "");
      // fired records are dropped only once their note is gone
      const a = this.settings.autoStatus;
      const before = JSON.stringify(a.fired);
      a.fired = keepAutoFired(a.fired, (p) => this.app.vault.getAbstractFileByPath(p) instanceof TFile);
      // tasks disabled on any board are left out
      const off = new Set(Object.values(this.settings.boards).flatMap((b) => b.disabled ?? []));
      const wrote = await view.applyAutoStatus(tasks.filter((t) => !off.has(t.path)));
      if (wrote.size || JSON.stringify(a.fired) !== before) await this.saveData(this.settings);
      // every open board updates its in-memory statuses and redraws
      if (wrote.size) for (const v of views()) v.takeStatuses(wrote);
    } while (this.autoAgain);
  }
}
