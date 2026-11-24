import { App, Notice, Platform, PluginSettingTab, Setting, TextComponent } from "obsidian";
// declarative-settings types (@since 1.13.0); type-only references call no runtime API,
// so they don't trip no-unsupported-api while minAppVersion stays at 1.11.4.
import type { SettingDefinitionItem, SettingDefinitionList, SettingGroupItem } from "obsidian";
import type GanttPlugin from "./main";
import { StatusDef, StatusGroup, STATUS_GROUPS, ZoomMode, DateFormat, Filter, FilterMatch, FilterPreset, CustomField, CustomFieldType } from "./types";
import { collectAllTags, customFieldIssues, filesWithFrontmatterKey, newStatus, renameFrontmatterKey } from "./model";
import { ColumnDef, allColumns, columnList, moveColumn, toggleColumn } from "./columns";
import { AutoFired, autoStatusTargets, renameAutoStatusId } from "./schedule";
import { dayToStr, formatDate, todayIndex } from "./timeline";
import { ChoiceModal, ConfirmModal, PickModal } from "./modals";
import { obsidianTagColor, toHex } from "./colors";
import { jsonObject } from "./ai";
import { checkAi } from "./ai-client";
import { pickColor } from "./popover";
import { t as tr, statusGroupLabel } from "./i18n";
import { LEADS, leadLabel, sendTestNotification } from "./notify";
import { connectGoogle, disconnectGoogle, isConnected } from "./gcal/auth";
import { listCalendars } from "./gcal/api";
import { syncGcal } from "./gcal/sync";
import { getClientSecret, setClientSecret } from "./gcal/secrets";

// timezone list (real offsets only, with representative cities)
const TZ_CITIES: [string, string][] = [
  ["-12:00", "Baker Island"],
  ["-11:00", "Midway, Niue"],
  ["-10:00", "Honolulu (Hawaii)"],
  ["-09:30", "Marquesas Islands"],
  ["-09:00", "Anchorage (Alaska)"],
  ["-08:00", "Los Angeles, Vancouver"],
  ["-07:00", "Denver, Phoenix"],
  ["-06:00", "Chicago, Mexico City"],
  ["-05:00", "New York, Toronto, Lima"],
  ["-04:00", "Halifax, Santiago, La Paz"],
  ["-03:30", "St. John's (Newfoundland)"],
  ["-03:00", "São Paulo, Buenos Aires"],
  ["-02:00", "South Georgia"],
  ["-01:00", "Azores, Cape Verde"],
  ["+00:00", "London, Lisbon, UTC"],
  ["+01:00", "Paris, Berlin, Rome, Madrid"],
  ["+02:00", "Cairo, Athens, Kyiv"],
  ["+03:00", "Moscow, Istanbul, Riyadh"],
  ["+03:30", "Tehran"],
  ["+04:00", "Dubai, Baku, Tbilisi"],
  ["+04:30", "Kabul"],
  ["+05:00", "Karachi, Tashkent"],
  ["+05:30", "New Delhi, Mumbai, Colombo"],
  ["+05:45", "Kathmandu"],
  ["+06:00", "Dhaka, Almaty"],
  ["+06:30", "Yangon"],
  ["+07:00", "Bangkok, Jakarta, Hanoi"],
  ["+08:00", "Beijing, Singapore, Hong Kong, Taipei"],
  ["+08:45", "Eucla"],
  ["+09:00", "Tokyo, Osaka, Seoul"],
  ["+09:30", "Adelaide, Darwin"],
  ["+10:00", "Sydney, Melbourne, Guam"],
  ["+10:30", "Lord Howe Island"],
  ["+11:00", "Nouméa, Solomon Islands"],
  ["+12:00", "Auckland, Fiji"],
  ["+12:45", "Chatham Islands"],
  ["+13:00", "Apia (Samoa), Nuku'alofa (Tonga)"],
  ["+14:00", "Kiritimati"],
];

// Plugin settings
// after a status id change, re-point the status values of the saved filters and presets
export function renameStatusInFilters(s: GanttSettings, from: string, to: string): void {
  for (const list of [s.filters, ...s.filterPresets.map((x) => x.filters)])
    for (const f of list) if (f.kind === "category" && f.field === "status") f.values = f.values.map((v) => (v === from ? to : v));
}

// statuses the last renames wrote, so the next rename finds them before the metadata cache catches up
const written = new Map<string, string>();
let renaming: Promise<unknown> = Promise.resolve();

// after a status id change, rewrite the notes holding it under the default folder; returns how many were written. Notes in a read-only
// room aren't written. Back-to-back renames run one after another (no note is left on a dead id). Not undoable with Ctrl+Z
export function renameStatusInNotes(app: App, root: string, key: string, from: string, to: string): Promise<number> {
  const run = renaming.then(async () => {
    const rooms = (app as unknown as { plugins?: { plugins?: Record<string, { canWrite?: (path: string) => boolean | null }> } }).plugins?.plugins?.["vault-rooms"];
    let n = 0;
    for (const file of app.vault.getMarkdownFiles()) {
      if (root && !file.path.startsWith(root + "/")) continue;
      if ((written.get(file.path) ?? app.metadataCache.getFileCache(file)?.frontmatter?.[key]) !== from) continue;
      if (rooms?.canWrite?.(file.path) === false) continue;
      await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        if (fm[key] === from) {
          fm[key] = to;
          written.set(file.path, to);
          n++;
        }
      });
    }
    return n;
  });
  renaming = run.catch(() => undefined);
  return run;
}

export interface GanttSettings {
  rootFolder: string; // parent folder to aggregate
  taskTemplate: string; // the note new note tasks are copied from (empty: an empty note)
  recurse: boolean; // recurse into subfolders
  statuses: StatusDef[];
  defaultZoom: ZoomMode;
  dateFormat: DateFormat; // display-only date format
  // timezone for displaying/saving times: "system" (device) or a fixed GMT offset like "+09:00"
  tz: string;
  // non-working weekdays (0 = Sun … 6 = Sat); durations and dependency cascades count workdays only
  nonWorkingDays: number[];
  // set once the old saved default (Sat+Sun) has been moved to 2.17's default (Fri+Sat)
  weekendMigrated?: boolean;
  // set once the old default date format (YYYY/MM/DD) has been moved to the glance format ("Tue 24 Nov")
  dateFormatMigrated?: boolean;
  // the plan assistant's server: OpenAI-compatible, on the LAN (Ollama, vLLM, llama.cpp, LM Studio); its key, when one is needed, lives
  // in SecretStorage (aiKey below), never here
  ai: AiSettings;
  // push FS successors when a slipping predecessor overlaps them
  autoScheduleFS: boolean;
  // move statuses on by date (off by default); an empty id or list means the default (the built-in in-progress / done, the first active status).
  // `fired` holds the date each rule fired for, per note path (not applied again while that date stands, even if undone or set back by hand)
  autoStatus: { enabled: boolean; started: string; finished: string; notStarted: string[]; fired: AutoFired };
  detailWidth: number; // detail panel width (px)
  // a kanban's cards in the detail panel: a checklist by lane (default) or side-by-side lanes like the Kanban plugin
  cardView: "list" | "board";
  // where Execution sits in the detail panel: after the fields (default) or right under the title
  execPosition: "top" | "bottom";
  visibleColumns: string[]; // optional columns shown (name is always shown)
  // the optional columns' order (column ids; missing ones follow in definition order)
  columnOrder: string[];
  columnWidths: Record<string, number>; // per-column width overrides (px); unset = default
  sortBy: string; // sort column id (custom fields: cf:<id>)
  sortDir: "asc" | "desc"; // sort direction
  // custom fields: arbitrary frontmatter keys as table columns
  customFields: CustomField[];
  // unified filters + combine mode
  filters: Filter[];
  filterMatch: FilterMatch; // all = match all (AND), any = match any (OR)
  filterPresets: FilterPreset[]; // user-defined filter presets
  progressLineColor: string; // progress line color
  // default tag color; empty = follow Obsidian's own tag color
  defaultTagColor: string;
  // only tags with an explicit colour are listed (listed ⇔ coloured); the colour is never empty
  tagColors: { name: string; color: string }[];
  folderColors: { name: string; color: string }[];
  assigneeColors: { name: string; color: string }[]; // colours keyed by an assignee's display name
  // group heading icons, keyed "<group-by axis>:<heading>"
  icons: Record<string, string>;
  // each board's view setup, keyed "folder:<path>" ("folder:" = vault root; "base:<id>" is left free for Bases boards)
  boards: Record<string, BoardState>;
  // notifications via incoming webhooks
  notify: {
    discordWebhook: string; // empty disables
    slackWebhook: string;
    teamsWebhook: string; // Power Automate Workflows webhook
    notifyStart: boolean; // notify for start
    notifyEnd: boolean; // notify for due
    leads: string[]; // enabled lead ids
    sent: Record<string, number>; // sent keys → timestamp (dedupe)
  };
  // Google Calendar two-way sync
  gcal: {
    clientId: string; // the user's own GCP OAuth client
    // the client secret and refresh token live in SecretStorage (gcal/secrets.ts)
    calendarId: string; // target calendar
    calendarName: string; // display only
    pushEnabled: boolean; // task → GCal
    pullEnabled: boolean; // GCal → task
    optInOnly: boolean; // only tasks carrying the opt-in flag
    scopeFolder: string; // empty = follow the default folder
    pullIntervalMin: number; // pull interval in minutes
    deleteEventOnTaskDelete: boolean;
    onEventDeleted: "unlink" | "clearDates"; // behavior when the event is deleted remotely
    syncToken: string; // incremental pull token
    lastSync: number; // last successful sync
    lastError: string; // latest error, shown in settings
    state: Record<string, GcalSyncState>; // path → sync snapshot
  };
  // frontmatter key names
  keys: {
    start: string;
    end: string;
    status: string;
    assignee: string;
    after: string;
    progress: string;
    milestone: string;
    parent: string;
    gcalId: string; // where the event id is stored
    gcal: string; // the opt-in flag
    canvas: string; // a canvas task's link to its .canvas
    priority: string; // priority (urgent marks interrupting work)
    interrupts: string; // links from urgent work to the tasks it interrupted
    completed: string; // the day the task entered the Completed group (written with the status)
    blocker: string; // why it is blocked (only while in the Deferred group; cleared on leaving it)
  };
}

// this device's user name (for "My work"; per device, never synced)
export const ME_KEY = "task-gantt-me";

// the AI server's key, in Obsidian's SecretStorage (the OS keychain): data.json travels through sync and backups. Clearing writes "" (no delete API)
const AI_KEY = "task-gantt-ai-key";
export function aiKey(plugin: GanttPlugin): string {
  try {
    return plugin.app.secretStorage.getSecret(AI_KEY) ?? "";
  } catch (e) {
    console.error("Task Gantt: failed to read the AI key", e);
    return "";
  }
}
export function setAiKey(plugin: GanttPlugin, value: string): void {
  plugin.app.secretStorage.setSecret(AI_KEY, value);
}

export interface AiSettings {
  url: string; // the server's address, ending in /v1
  model: string;
  api: "chat" | "responses"; // Chat Completions, or the Responses API
  chatPath: string; // a path under the url, or a full URL
  embedModel: string; // "" = no search by meaning
  embedPath: string;
  body: string; // a JSON object added to each chat request ("" = none)
  headers: string; // a JSON object of headers, {key} standing for the key ("" = the key as a bearer token)
  timeout: number; // seconds to wait for an answer
  instructions: string; // the team's own, after the built-in ones
}

// each API's usual endpoint, under the server URL
export const AI_PATHS = { chat: "/chat/completions", responses: "/responses" } as const;

// a board's view setup, kept across reopening
export interface BoardState {
  groupBy: "folder" | "status" | "assignee" | "tag";
  colorBy: "status" | "assignee";
  flat: boolean;
  rollup: boolean;
  progressLine: boolean;
  showEmptyFolders: boolean;
  showDeps: boolean; // whether dependency arrows are drawn
  showTags: boolean; // whether tags show on the bars
  collapsed: string[];
  expanded?: string[]; // expanded parent tasks (paths; parents start collapsed)
  order?: string[]; // the manual row order (task paths)
  disabled?: string[]; // disabled tasks (paths; nothing is written to the notes)
}

// per-task sync snapshot (drives loop prevention and change detection)
export interface GcalSyncState {
  id: string; // event id
  hash: string; // local fingerprint at last sync
  etag: string; // event etag at last sync (echo detection)
  at: number; // synced at (epoch ms)
  link?: string; // the event's htmlLink
}

export const DEFAULT_SETTINGS: GanttSettings = {
  rootFolder: "",
  taskTemplate: "",
  ai: { url: "", model: "", api: "chat", chatPath: "/chat/completions", embedModel: "", embedPath: "/embeddings", body: "", headers: "", timeout: 180, instructions: "" },
  recurse: true,
  statuses: [
    { id: "todo", label: "To do", color: "#9aa0a6", group: "active" },
    { id: "in-progress", label: "In progress", color: "#3b82f6", group: "active" },
    // stalled work maps to Wrike's Deferred
    { id: "blocked", label: "Blocked", color: "#ef4444", group: "deferred" },
    { id: "done", label: "Done", color: "#22c55e", group: "completed" },
  ],
  defaultZoom: "Week",
  dateFormat: "ddd D MMM",
  tz: "system",
  nonWorkingDays: [5, 6], // a Sunday-to-Thursday week
  autoScheduleFS: true,
  autoStatus: { enabled: false, started: "", finished: "", notStarted: [], fired: {} },
  detailWidth: 380,
  execPosition: "bottom",
  cardView: "list", // reads top to bottom in a narrow panel, no sideways scrolling
  // what a glance needs: assignee, status, progress, due (the bar shows the start)
  visibleColumns: ["assignee", "status", "end"], // Progress is off by default (a kanban's count is in its cue), leaving the timeline wider
  columnOrder: ["assignee", "status", "progress", "end", "start", "duration", "tags"], // who, what state, how far, by when
  columnWidths: {},
  sortBy: "start",
  sortDir: "asc",
  customFields: [],
  filters: [],
  filterMatch: "all",
  filterPresets: [],
  progressLineColor: "#f59e0b", // amber, unlikely to clash with bar colors
  defaultTagColor: "", // empty = Obsidian's own tag color
  tagColors: [],
  folderColors: [],
  assigneeColors: [],
  icons: {},
  boards: {},
  notify: {
    discordWebhook: "",
    slackWebhook: "",
    teamsWebhook: "",
    notifyStart: true,
    notifyEnd: true,
    leads: ["1d", "1h", "10m"],
    sent: {},
  },
  gcal: {
    clientId: "",
    calendarId: "",
    calendarName: "",
    pushEnabled: true,
    pullEnabled: true,
    optInOnly: true,
    scopeFolder: "",
    pullIntervalMin: 5,
    deleteEventOnTaskDelete: true,
    onEventDeleted: "unlink",
    syncToken: "",
    lastSync: 0,
    lastError: "",
    state: {},
  },
  keys: {
    start: "start",
    end: "end",
    status: "status",
    assignee: "assignee",
    after: "after",
    progress: "progress",
    milestone: "milestone",
    parent: "parent",
    gcalId: "gcalId",
    gcal: "gcal",
    canvas: "canvas",
    priority: "priority",
    interrupts: "interrupts",
    completed: "completed",
    blocker: "blocker",
  },
};

// The settings tab renders declaratively through getSettingDefinitions() (1.13+); older Obsidian falls back to
// display(), which draws the same definitions with classic Settings (both come from definitions(), so they can't drift).
export class GanttSettingTab extends PluginSettingTab {
  plugin: GanttPlugin;

  // whether the tab renders declaratively: getSettingDefinitions() is only called on 1.13+,
  // so true means redraw via update(), false means redraw via the display()-side draw().
  private declarative = false;


  constructor(app: App, plugin: GanttPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  // whether a field saved once typed holds a change not saved yet
  private dirty = false;

  private save(): void {
    this.dirty = false;
    void this.plugin.saveSettings();
  }

  // on closing, save what a field still being typed holds (closing with Esc fires no change)
  hide(): void {
    if (this.dirty) this.save();
    super.hide();
  }

  // redraw from outside the tab (e.g. a right-click in the table) when it happens to be open
  refreshIfOpen(): void {
    if (this.declarative) this.updateDeclarative();
    else if (this.containerEl.firstChild) this.draw();
  }

  // redraw after a change that alters the structure, routed by which renderer is in use
  private redraw(): void {
    if (this.declarative) this.updateDeclarative();
    else this.draw();
  }

  // update() is @since 1.13.0; to keep minAppVersion at 1.11.4 we avoid a typed direct call and
  // invoke it only when it exists at runtime (on 1.12 and older, `declarative` is never true).
  private updateDeclarative(): void {
    (this as unknown as { update?: () => void }).update?.();
  }

  // ===== control builders shared by getSettingDefinitions and the display() fallback =====
  private ctlRootFolder(setting: Setting): void {
    const s = this.plugin.settings;
    // saved on commit only, so boards don't reload on a half-typed folder
    setting.addText((t) => {
      t.setPlaceholder(tr().setDefaultFolderPlaceholder).setValue(s.rootFolder);
      t.inputEl.addEventListener("change", () => {
        s.rootFolder = t.getValue().trim();
        this.save();
      });
    });
  }

  private ctlTemplate(setting: Setting): void {
    const s = this.plugin.settings;
    setting.addText((t) => {
      t.setPlaceholder(tr().setTemplatePlaceholder).setValue(s.taskTemplate);
      t.inputEl.addEventListener("change", () => {
        s.taskTemplate = t.getValue().trim();
        this.save();
      });
    });
  }

  private ctlRecurse(setting: Setting): void {
    const s = this.plugin.settings;
    setting.addToggle((t) => t.setValue(s.recurse).onChange((v) => { s.recurse = v; this.save(); }));
  }

  private ctlZoom(setting: Setting): void {
    const s = this.plugin.settings;
    setting.addDropdown((d) =>
      d.addOptions({ Day: tr().zoomDay, Week: tr().zoomWeek, Month: tr().zoomMonth, Fit: tr().zoomFit }).setValue(s.defaultZoom).onChange((v) => {
        s.defaultZoom = v as ZoomMode;
        this.save();
      })
    );
  }

  private ctlDateFormat(setting: Setting): void {
    const s = this.plugin.settings;
    setting.addDropdown((d) =>
      d
        .addOptions({ "ddd D MMM": formatDate(dayToStr(todayIndex()), "ddd D MMM"), "YYYY/MM/DD": "YYYY/MM/DD", "DD/MM/YYYY": "DD/MM/YYYY", "MM/DD/YYYY": "MM/DD/YYYY" })
        .setValue(s.dateFormat)
        .onChange((v) => { s.dateFormat = v as DateFormat; this.save(); })
    );
  }

  private ctlTimezone(setting: Setting): void {
    const s = this.plugin.settings;
    const opts: Record<string, string> = { system: tr().setTimezoneSystem };
    // list offsets with representative cities
    for (const [v, cities] of TZ_CITIES) opts[v] = `GMT${v} — ${cities}`;
    // keep a saved offset selectable even if it left the list
    if (s.tz !== "system" && !opts[s.tz]) opts[s.tz] = `GMT${s.tz}`;
    setting.addDropdown((d) => d.addOptions(opts).setValue(s.tz).onChange((v) => { s.tz = v; this.save(); }));
  }

  // non-working weekdays, picked from common patterns (a saved value outside the list stays selectable)
  private ctlNonWorkingDays(setting: Setting): void {
    const s = this.plugin.settings;
    // keys aren't bare digits: integer-like keys get hoisted to the front of an object and reorder the options
    // the default (Friday and Saturday, a Sunday-to-Thursday week) comes first
    const presets: Record<string, number[]> = { friSat: [5, 6], satSun: [0, 6], sun: [0], none: [] };
    const opts: Record<string, string> = {
      friSat: tr().setWeekendFriSat,
      satSun: tr().setWeekendSatSun,
      sun: tr().setWeekendSun,
      none: tr().setWeekendNone,
    };
    const same = (a: number[], b: number[]): boolean => a.length === b.length && a.every((x) => b.includes(x));
    let cur = Object.keys(presets).find((k) => same(presets[k], s.nonWorkingDays));
    if (!cur) {
      cur = "custom";
      opts.custom = [...s.nonWorkingDays].sort((a, b) => a - b).join(",");
      presets.custom = [...s.nonWorkingDays];
    }
    setting.addDropdown((d) =>
      d.addOptions(opts).setValue(cur).onChange((v) => {
        s.nonWorkingDays = [...(presets[v] ?? [])];
        this.save();
      })
    );
  }

  private ctlAutoScheduleFS(setting: Setting): void {
    const s = this.plugin.settings;
    setting.addToggle((t) => t.setValue(s.autoScheduleFS).onChange((v) => { s.autoScheduleFS = v; this.save(); }));
  }

  // ===== automatic status by date =====
  private ctlAutoStatus(setting: Setting): void {
    const a = this.plugin.settings.autoStatus;
    setting.addToggle((t) => t.setValue(a.enabled).onChange((v) => {
      a.enabled = v;
      this.save();
    }));
  }

  // the started (active group) or finished (completed group) status; the shown value is the resolved default
  private ctlAutoStatusTarget(setting: Setting, which: "started" | "finished"): void {
    const s = this.plugin.settings;
    const group = which === "started" ? "active" : "completed";
    const cur = autoStatusTargets(s.statuses, s.autoStatus)[which];
    setting.addDropdown((d) => {
      if (!cur) d.addOption("", "—"); // no matching status yet
      for (const st of s.statuses.filter((x) => x.group === group)) d.addOption(st.id, st.label);
      d.setValue(cur ?? "").onChange((v) => {
        s.autoStatus[which] = v;
        this.save();
        if (which === "started") this.redraw(); // the not-started choices change
      });
    });
  }

  // the statuses that count as not started (active ones other than the started target); the last one can't be unticked (empty means the default)
  private ctlAutoStatusNotStarted(setting: Setting): void {
    const s = this.plugin.settings;
    const { started, notStarted } = autoStatusTargets(s.statuses, s.autoStatus);
    const host = setting.controlEl.createDiv({ cls: "ogantt-setting-checks" });
    const boxes: HTMLInputElement[] = [];
    for (const st of s.statuses.filter((x) => x.group === "active" && x.id !== started)) {
      const item = host.createEl("label");
      const cb = item.createEl("input", { type: "checkbox", value: st.id });
      cb.checked = notStarted.includes(st.id);
      item.appendText(st.label);
      boxes.push(cb);
      cb.addEventListener("change", () => {
        s.autoStatus.notStarted = boxes.filter((b) => b.checked).map((b) => b.value);
        sync();
        this.save();
      });
    }
    const sync = () => {
      const on = boxes.filter((b) => b.checked);
      for (const b of boxes) b.disabled = on.length === 1 && b.checked;
    };
    sync();
  }

  // ===== table columns =====

  // one column row: show in the table, up/down arrows and the width; hidden columns sit dimmed at the bottom and work the same (their settings are kept)
  private ctlColumnRow(setting: Setting, col: ColumnDef, on: boolean, canUp: boolean, canDown: boolean): void {
    const s = this.plugin.settings;
    setting.setName(col.label()).setClass("ogantt-col-row");
    if (!on) setting.setClass("ogantt-col-off");
    setting.addToggle((t) => {
      t.setValue(on).onChange((v) => this.changeColumns(`${col.id}|0`, () => Object.assign(s, toggleColumn(allColumns(this.plugin.settings), s.visibleColumns, s.columnOrder, col.id, v))));
      t.toggleEl.setAttr("aria-label", `${tr().setColumnShown}: ${col.label()}`);
      t.toggleEl.dataset.col = `${col.id}|0`;
    });
    for (const dir of [-1, 1] as const) {
      setting.addButton((b) => {
        b.setIcon(dir < 0 ? "arrow-up" : "arrow-down")
          .setTooltip(dir < 0 ? tr().colMoveUp(col.label()) : tr().colMoveDown(col.label()))
          .setDisabled(dir < 0 ? !canUp : !canDown)
          .onClick(() => this.changeColumns(`${col.id}|${dir}`, () => {
            s.columnOrder = moveColumn(allColumns(this.plugin.settings), s.visibleColumns, s.columnOrder, col.id, dir) ?? s.columnOrder;
          }));
        b.buttonEl.addClass("clickable-icon");
        b.buttonEl.dataset.col = `${col.id}|${dir}`;
      });
    }
    // the width (blank = the default); hidden columns can be changed too
    setting.addText((t) => {
      t.inputEl.type = "number";
      t.inputEl.min = "40";
      t.inputEl.addClass("ogantt-col-width");
      t.inputEl.setAttr("aria-label", `${tr().setColumnWidth}: ${col.label()}`);
      const w = s.columnWidths[col.id];
      t.setPlaceholder(String(col.width)).setValue(w != null ? String(w) : "").onChange((v) => {
        const n = Math.round(Number(v));
        if (!v.trim()) delete s.columnWidths[col.id];
        else if (n >= 40) s.columnWidths[col.id] = n;
        else return;
        this.save();
      });
    });
  }

  // change the columns' visibility or order, redraw, and put focus back on the same control (on the other arrow once one is disabled at an end)
  private changeColumns(focus: string, change: () => void): void {
    change();
    this.save();
    this.redraw();
    window.setTimeout(() => {
      const el = this.containerEl.querySelector<HTMLElement>(`[data-col="${CSS.escape(focus)}"]`);
      const row = el?.closest(".setting-item");
      (el?.matches(":disabled") ? row?.querySelector<HTMLElement>("button:not(:disabled)") : el)?.focus();
    }, 0);
  }

  // a colour control: a swatch button that opens the palette (+ custom)
  private ctlColor(setting: Setting, get: () => string, set: (color: string) => void): Setting {
    return setting.addButton((b) => {
      b.buttonEl.addClass("ogantt-swatch");
      b.buttonEl.setAttr("aria-label", tr().setStatusColor);
      b.buttonEl.style.background = get();
      b.onClick(() => pickColor(b.buttonEl, get(), (c) => {
        set(c);
        b.buttonEl.style.background = c;
        this.save();
      }));
    });
  }

  // progress line color (palette + reset to default)
  // this device's name lives in local storage, not data.json (it differs per person in a shared vault)
  private ctlMe(setting: Setting): void {
    const app = this.plugin.app;
    setting.addText((t) => t.setValue((app.loadLocalStorage(ME_KEY) as string | null) ?? "").onChange((v) => app.saveLocalStorage(ME_KEY, v.trim() || null)));
  }

  private ctlCardView(setting: Setting): void {
    const s = this.plugin.settings;
    setting.addDropdown((d) =>
      d.addOptions({ list: tr().setCardViewList, board: tr().setCardViewBoard }).setValue(s.cardView).onChange((v) => {
        s.cardView = v === "board" ? "board" : "list";
        this.save();
      })
    );
  }

  private ctlExecPosition(setting: Setting): void {
    const s = this.plugin.settings;
    setting.addDropdown((d) =>
      d.addOptions({ bottom: tr().setExecPositionBottom, top: tr().setExecPositionTop }).setValue(s.execPosition).onChange((v) => {
        s.execPosition = v === "top" ? "top" : "bottom";
        this.save();
      })
    );
  }

  private ctlProgressLineColor(setting: Setting): void {
    const s = this.plugin.settings;
    this.ctlColor(setting, () => s.progressLineColor || DEFAULT_SETTINGS.progressLineColor, (c) => (s.progressLineColor = c))
      .addExtraButton((b) =>
        b.setIcon("rotate-ccw").setTooltip(tr().setResetTooltip).onClick(() => {
          s.progressLineColor = DEFAULT_SETTINGS.progressLineColor;
          this.save();
          this.redraw(); // refresh the picker's shown value
        })
      );
  }

  // column names for the list: a row is just id/label/group/color with no name field, so say which is
  // which. The grid on .ogantt-status-row places the columns, so the four labels land on the four
  // controls regardless of how wide each control renders
  private ctlStatusHeader(setting: Setting): void {
    setting.setClass("ogantt-setting-row").setClass("ogantt-status-row").setClass("ogantt-setting-head");
    const c = setting.controlEl;
    c.createSpan({ text: tr().setStatusId });
    c.createSpan({ text: tr().setStatusLabel });
    c.createSpan({ text: tr().setStatusGroup });
    c.createSpan({ text: tr().setStatusColor });
  }

  // one status row, delete button included: keeping deletion on the row instead of the framework's
  // onDelete means a column-header row at the top of the list can't throw off which row gets removed
  private ctlStatusRow(setting: Setting, st: StatusDef): void {
    setting
      .addText((t) => {
        // the id changes and saves only on commit (so automatic status never runs on a half-typed id); the automatic-status targets follow it
        t.setPlaceholder(tr().setStatusId).setValue(st.id);
        t.inputEl.addEventListener("change", () => void (async () => {
          const was = st.id;
          const id = t.getValue().trim();
          // an empty or already-used id is refused and put back
          if (!id || this.plugin.settings.statuses.some((o) => o !== st && o.id === id)) return void t.setValue(was);
          if (id === was) return;
          st.id = id;
          renameAutoStatusId(this.plugin.settings.autoStatus, was, id);
          renameStatusInFilters(this.plugin.settings, was, id);
          this.plugin.renameStatusInTabs(was, id);
          this.save();
          // the notes holding it follow (left behind, finished work would read as open)
          const n = await renameStatusInNotes(this.app, this.plugin.settings.rootFolder ?? "", this.plugin.settings.keys.status, was, id);
          if (n) new Notice(tr().statusIdRenamed(n));
        })());
      })
      .addText((t) => {
        t.setPlaceholder(tr().setStatusLabel).setValue(st.label).onChange((v) => { st.label = v; this.dirty = true; }); // saved on commit (below)
        // the heading icon and collapse state kept by name move once, on commit
        let was = st.label;
        t.inputEl.addEventListener("change", () => {
          this.plugin.renameStatusKeys(was, st.label);
          was = st.label;
          this.save();
        });
      })
      // the group behind the completed/incomplete distinction; the four are fixed, as in Wrike
      .addDropdown((d) => {
        for (const g of STATUS_GROUPS) d.addOption(g, statusGroupLabel(g));
        d.setValue(st.group)
          .onChange((v) => {
            const warned = this.statusGroupWarning() !== undefined;
            st.group = v as StatusGroup;
            this.save();
            // redraw only when the advisory appears or disappears; doing it always steals focus
            if (warned !== (this.statusGroupWarning() !== undefined)) this.redraw();
          })
          .selectEl.setAttr("aria-label", tr().setStatusGroup);
      });
    this.ctlColor(setting, () => st.color, (c) => (st.color = c))
      .addExtraButton((b) =>
        b.setIcon("trash").setTooltip(tr().setDeleteTooltip).onClick(() => {
          // locate the row by identity, not by index, so a reordered list can't take out the wrong one
          const live = this.plugin.settings.statuses;
          const at = live.indexOf(st);
          if (at >= 0) live.splice(at, 1);
          renameAutoStatusId(this.plugin.settings.autoStatus, st.id, null);
          this.save();
          this.redraw();
        })
      );
  }

  // column names for the custom field list (key / label / type)
  private ctlCustomFieldHeader(setting: Setting): void {
    setting.setClass("ogantt-setting-row").setClass("ogantt-cf-row").setClass("ogantt-setting-head");
    const c = setting.controlEl;
    c.createSpan({ text: tr().setCfKey });
    c.createSpan({ text: tr().setCfLabel });
    c.createSpan({ text: tr().setCfType });
  }

  // one custom field row (key, label, type, delete). The key applies on commit (Enter / blur), not per keystroke,
  // so the column doesn't read some half-typed property and go blank, and renaming it in notes is asked once
  private ctlCustomFieldRow(setting: Setting, f: CustomField): void {
    setting
      .addText((t) => {
        t.setPlaceholder(tr().setCfKey).setValue(f.key);
        t.inputEl.addEventListener("change", () => this.commitCustomFieldKey(f, t));
      })
      .addText((t) => {
        t.setPlaceholder(tr().setCfLabel).setValue(f.label).onChange((v) => { f.label = v; this.dirty = true; });
        t.inputEl.addEventListener("change", () => this.save()); // saved once typed, not redrawing every board per key
      })
      .addDropdown((d) => {
        d.addOption("text", tr().cfTypeText).addOption("number", tr().cfTypeNumber).addOption("date", tr().cfTypeDate);
        d.setValue(f.type)
          .onChange((v) => { f.type = v as CustomFieldType; this.save(); })
          .selectEl.setAttr("aria-label", tr().setCfType);
      })
      .addExtraButton((b) =>
        b.setIcon("trash").setTooltip(tr().setDeleteTooltip).onClick(() => {
          // tidy up the column's visibility, width and sort (the values in notes are left alone)
          const s = this.plugin.settings;
          const at = s.customFields.indexOf(f);
          if (at >= 0) s.customFields.splice(at, 1);
          const col = `cf:${f.id}`;
          s.visibleColumns = s.visibleColumns.filter((c) => c !== col);
          s.columnOrder = s.columnOrder.filter((c) => c !== col);
          delete s.columnWidths[col];
          if (s.sortBy === col) {
            s.sortBy = "start";
            s.sortDir = "asc";
          }
          this.save();
          this.redraw();
        })
      );
  }

  // commit a key change. If notes hold values under the old key, ask whether to rename it there too (the settings
  // tab has no undo, hence the dialog). When either key clashes with a built-in or another field, only the setting changes
  private commitCustomFieldKey(f: CustomField, input: TextComponent): void {
    const s = this.plugin.settings;
    const oldKey = f.key.trim();
    const newKey = input.getValue().trim();
    if (oldKey === newKey) return;
    const apply = (): void => {
      const before = this.customFieldWarnings().join("|");
      f.key = newKey;
      this.save();
      // redraw only when the advisory changes (this runs on commit, so no typing is interrupted)
      if (this.customFieldWarnings().join("|") !== before) this.redraw();
    };
    const reserved = new Set([...Object.values(s.keys), "tags"]);
    const clashes = (key: string): boolean => reserved.has(key) || s.customFields.some((o) => o !== f && o.key.trim() === key);
    const files = oldKey && newKey && !clashes(oldKey) && !clashes(newKey) ? filesWithFrontmatterKey(this.app, oldKey) : [];
    if (files.length === 0) {
      apply();
      return;
    }
    new ChoiceModal(this.app, {
      title: tr().cfRenameTitle,
      body: tr().cfRenameBody(files.length, oldKey, newKey),
      sub: tr().cfRenameSub,
      choices: [
        { text: tr().cfRenameSettingOnly, onPick: apply },
        {
          text: tr().cfRenameInNotes,
          cta: true,
          onPick: () => void (async () => {
            const r = await renameFrontmatterKey(this.app, files, oldKey, newKey);
            apply();
            new Notice(tr().cfRenamed(r.renamed) + (r.skipped ? `\n${tr().cfRenameSkipped(r.skipped, newKey)}` : ""));
          })(),
        },
      ],
      // closing without a choice reverts the key
      onDismiss: () => {
        input.setValue(oldKey);
      },
    }).open();
  }

  // add a custom field; its id never changes (renaming the key keeps the column's settings), and its column starts out visible
  private addCustomField(): void {
    const s = this.plugin.settings;
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    s.customFields.push({ id, key: "", label: "", type: "text" });
    s.visibleColumns = [...s.visibleColumns, `cf:${id}`];
    this.save();
    this.redraw();
  }

  // the custom field advisory (empty keys, clashes with built-in keys, duplicates); empty means no row at all —
  // placing a row and hiding it leaves an empty group frame behind in the declarative tab
  private customFieldWarnings(): string[] {
    const s = this.plugin.settings;
    const issues = customFieldIssues(s);
    const lines = new Set<string>();
    for (const f of s.customFields) {
      const issue = issues.get(f.id);
      if (issue === "empty") lines.add(tr().setCfEmpty);
      else if (issue === "reserved") lines.add(tr().setCfReserved(f.key.trim()));
      else if (issue === "duplicate") lines.add(tr().setCfDuplicate(f.key.trim()));
    }
    return [...lines];
  }

  // fill the advisory row, one line per issue
  private ctlCustomFieldWarning(setting: Setting, lines: string[]): void {
    setting.setClass("ogantt-setting-warn");
    for (const line of lines) setting.descEl.createDiv({ text: line });
  }

  // an empty Completed group makes the completed preset always empty; say so without forbidding it
  private statusGroupWarning(): string | undefined {
    return this.plugin.settings.statuses.some((s) => s.group === "completed")
      ? undefined
      : tr().setNoCompletedStatus;
  }

  // one row per explicitly coloured tag; a row exists only when a colour is set, so it's never empty
  private ctlTagColorRow(setting: Setting, tc: { name: string; color: string }): void {
    setting.addText((t) => t.setValue(tc.name).setDisabled(true));
    this.ctlColor(setting, () => tc.color, (c) => (tc.color = c))
      .addExtraButton((b) =>
        b.setIcon("x").setTooltip(tr().confirmDropTagColorOk).onClick(() => this.confirmRemoveTagColor(tc))
      );
  }

  // display order: the list is a lookup table with no meaningful order, and rows arrive from two
  // different places, so insertion order is unpredictable — sort by tag name instead
  private sortedTagColors(): { name: string; color: string }[] {
    return this.plugin.settings.tagColors.slice().sort((a, b) => a.name.localeCompare(b.name));
  }

  // drop a colour override, which removes the row; the settings tab has no undo, so confirm first
  private confirmRemoveTagColor(tc: { name: string; color: string }): void {
    new ConfirmModal(this.plugin.app, {
      title: tr().confirmDropTagColorTitle,
      body: tr().confirmDropTagColorBody(tc.name),
      sub: tr().confirmDropTagColorSub,
      confirmText: tr().confirmDropTagColorOk,
      cancelText: tr().cancel,
      onConfirm: () => {
        const live = this.plugin.settings.tagColors;
        const at = live.indexOf(tc);
        if (at >= 0) live.splice(at, 1);
        this.save();
        this.redraw();
      },
    }).open();
  }

  // pick the tag to colour from the vault's own list; typing it by hand invites a silent typo
  private pickTagToColor(): void {
    const s = this.plugin.settings;
    const taken = new Set(s.tagColors.map((c) => c.name.toLowerCase()));
    const choices = collectAllTags(this.plugin.app).filter((tag) => !taken.has(tag.toLowerCase()));
    if (choices.length === 0) {
      new Notice(tr().setNoTagsToColor);
      return;
    }
    new PickModal(this.plugin.app, choices, (tag) => tag, tr().setPickTagPlaceholder, (tag) => {
      // seed with the default so the user edits from there
      s.tagColors.push({ name: tag, color: toHex(s.defaultTagColor || obsidianTagColor()) });
      this.save();
      this.redraw();
    }).open();
  }

  // default tag color (empty = auto from the name)
  private ctlDefaultTagColor(setting: Setting): void {
    const s = this.plugin.settings;
    this.ctlColor(setting, () => s.defaultTagColor || obsidianTagColor(), (c) => (s.defaultTagColor = c))
      .addExtraButton((b) =>
        b.setIcon("rotate-ccw").setTooltip(tr().setDefaultTagColorAuto).onClick(() => {
          s.defaultTagColor = ""; // back to Obsidian's own tag color
          this.save();
          this.redraw();
        })
      );
  }

  private ctlKeyRow(setting: Setting, k: keyof GanttSettings["keys"]): void {
    const s = this.plugin.settings;
    // saved on commit only, so automatic status never reads every note with a half-typed key
    setting.addText((t) => {
      t.setValue(s.keys[k]);
      t.inputEl.addEventListener("change", () => {
        s.keys[k] = t.getValue().trim() || k;
        t.setValue(s.keys[k]);
        this.save();
      });
    });
  }

  private ctlWebhook(setting: Setting, key: "discordWebhook" | "slackWebhook" | "teamsWebhook", placeholder: string): void {
    const n = this.plugin.settings.notify;
    setting.addText((t) => {
      t.setPlaceholder(placeholder).setValue(n[key]).onChange((v) => { n[key] = v.trim(); this.dirty = true; });
      t.inputEl.addEventListener("change", () => this.save()); // saved once typed
    });
  }

  private ctlNotifyToggle(setting: Setting, key: "notifyStart" | "notifyEnd"): void {
    const n = this.plugin.settings.notify;
    setting.addToggle((t) => t.setValue(n[key]).onChange((v) => { n[key] = v; this.save(); }));
  }

  private ctlLeadToggle(setting: Setting, id: string): void {
    const n = this.plugin.settings.notify;
    setting.addToggle((t) =>
      t.setValue(n.leads.includes(id)).onChange((v) => {
        n.leads = v ? [...new Set([...n.leads, id])] : n.leads.filter((x) => x !== id);
        this.save();
      })
    );
  }

  // ===== the Google Calendar sync rows =====
  // one helper per row, shared by display() and getSettingDefinitions() so the two can't drift
  private ctlGcalClientId(setting: Setting): void {
    const g = this.plugin.settings.gcal;
    setting.addText((t) => {
      t.setValue(g.clientId).onChange((v) => { g.clientId = v.trim(); this.dirty = true; });
      t.inputEl.addEventListener("change", () => this.save()); // saved once typed
    });
  }

  // one of the assistant's text settings, saved once typed; the model field offers the models a check found
  private ctlAi(setting: Setting, key: "url" | "model" | "chatPath" | "embedModel" | "embedPath", placeholder: string): void {
    const a = this.plugin.settings.ai;
    setting.addText((t) => {
      t.setPlaceholder(placeholder).setValue(a[key]).onChange((v) => { a[key] = v.trim(); this.dirty = true; });
      t.inputEl.addEventListener("change", () => this.save());
      if (key === "model") t.inputEl.setAttr("list", "ogantt-ai-models");
    });
  }

  // the team's instructions, or a JSON object checked as it's typed (what's wrong shown under the description)
  private ctlAiArea(setting: Setting, key: "instructions" | "body" | "headers", placeholder: string): void {
    const a = this.plugin.settings.ai;
    setting.settingEl.addClass("ogantt-setting-stacked"); // the box goes under the description, full width
    const error = key === "instructions" ? null : setting.descEl.createDiv({ cls: "ogantt-setting-error" });
    const check = (v: string) => {
      const r = jsonObject(v);
      error?.setText(typeof r === "string" ? tr().aiBadJson(setting.nameEl.getText(), r) : "");
    };
    setting.addTextArea((t) => {
      t.setPlaceholder(placeholder).setValue(a[key]).onChange((v) => { a[key] = v; this.dirty = true; if (error) check(v); });
      t.inputEl.addEventListener("change", () => this.save());
      t.inputEl.rows = 3;
      t.inputEl.addClass("ogantt-ai-area");
      if (error) {
        t.inputEl.addClass("is-code");
        t.inputEl.spellcheck = false;
        check(a[key]);
      }
    });
  }

  // the API; its usual endpoint follows when the path was the other one's
  private ctlAiApi(setting: Setting): void {
    const a = this.plugin.settings.ai;
    setting.addDropdown((d) => d.addOption("chat", tr().aiApiChat).addOption("responses", tr().aiApiResponses).setValue(a.api).onChange((v) => {
      if (a.chatPath === AI_PATHS[a.api]) a.chatPath = AI_PATHS[v as AiSettings["api"]];
      a.api = v as AiSettings["api"];
      this.save();
      this.redraw();
    }));
  }

  private ctlAiTimeout(setting: Setting): void {
    const a = this.plugin.settings.ai;
    setting.addText((t) => {
      t.inputEl.type = "number";
      t.inputEl.min = "10";
      t.setValue(String(a.timeout)).onChange((v) => {
        const n = Math.round(Number(v));
        if (n >= 10) { a.timeout = n; this.dirty = true; }
      });
      t.inputEl.addEventListener("change", () => this.save());
    });
  }

  // Check: the server's models (offered in the Model field), a short chat with the tools and the embeddings, a line each
  private ctlAiCheck(setting: Setting): void {
    setting.addButton((b) => b.setButtonText(tr().setAiCheckButton).onClick(async () => {
      if (this.dirty) this.save();
      b.setDisabled(true);
      setting.descEl.setText(tr().aiChecking);
      const { lines, models } = await checkAi(this.plugin);
      setting.descEl.empty();
      for (const l of lines) setting.descEl.createDiv({ cls: l.ok ? "ogantt-check is-ok" : "ogantt-check is-bad", text: l.text });
      const list = this.containerEl.querySelector("#ogantt-ai-models") ?? this.containerEl.createEl("datalist", { attr: { id: "ogantt-ai-models" } });
      list.empty();
      for (const m of models) list.createEl("option", { attr: { value: m } });
      b.setDisabled(false);
    }));
  }

  // the advanced connection rows show when asked for, or when any of them is set
  private aiAdvanced?: boolean;
  private showAiAdvanced(): boolean {
    const a = this.plugin.settings.ai;
    const d = DEFAULT_SETTINGS.ai;
    return (this.aiAdvanced ??= (["api", "chatPath", "embedModel", "embedPath", "body", "headers", "timeout"] as const).some((k) => a[k] !== d[k]));
  }

  // saved to SecretStorage, not data.json
  private ctlAiKey(setting: Setting): void {
    setting.addText((t) => {
      t.inputEl.type = "password";
      t.setValue(aiKey(this.plugin)).onChange((v) => setAiKey(this.plugin, v.trim()));
    });
  }

  // saved to SecretStorage, not data.json
  private ctlGcalClientSecret(setting: Setting): void {
    setting.addText((t) => {
      t.inputEl.type = "password";
      t.setValue(getClientSecret(this.plugin)).onChange((v) => setClientSecret(this.plugin, v.trim()));
    });
  }

  // connect / disconnect, redrawn once the state flips
  private ctlGcalAccount(setting: Setting): void {
    setting.addButton((b) => {
      if (isConnected(this.plugin)) {
        // setDestructive() requires @since 1.13.0, incompatible with minAppVersion 1.11.4 (trips no-unsupported-api);
        // instead of the deprecated setWarning(), add the same mod-warning class it applies.
        b.buttonEl.addClass("mod-warning");
        b.setButtonText(tr().setGcalDisconnect).onClick(() => void (async () => {
          await disconnectGoogle(this.plugin);
          this.redraw();
        })());
      } else {
        b.setButtonText(tr().setGcalConnect).setCta().onClick(() => void (async () => {
          const ok = await connectGoogle(this.plugin);
          if (ok) this.redraw();
        })());
      }
    });
  }

  // target calendar (the list loads asynchronously)
  private ctlGcalCalendar(setting: Setting): void {
    const g = this.plugin.settings.gcal;
    setting.addDropdown((d) => {
      if (g.calendarId) d.addOption(g.calendarId, g.calendarName || g.calendarId);
      else d.addOption("", "—");
      d.setValue(g.calendarId);
      // the declarative tab renders hidden rows too, so only fetch while connected
      if (!isConnected(this.plugin)) return;
      void listCalendars(this.plugin)
        .then((cals) => {
          d.selectEl.empty();
          if (!g.calendarId) d.addOption("", "—");
          for (const c of cals) d.addOption(c.id, c.summary + (c.primary ? " ★" : ""));
          d.setValue(g.calendarId);
          d.onChange((v) => {
            g.calendarId = v;
            g.calendarName = cals.find((c) => c.id === v)?.summary ?? v;
            // switching calendars resets the sync state
            g.syncToken = "";
            g.state = {};
            this.save();
          });
        })
        .catch((e) => console.error("Task Gantt: calendar list failed", e));
    });
  }

  private ctlGcalToggle(setting: Setting, key: "pushEnabled" | "pullEnabled" | "optInOnly" | "deleteEventOnTaskDelete"): void {
    const g = this.plugin.settings.gcal;
    setting.addToggle((t) => t.setValue(g[key]).onChange((v) => { g[key] = v; this.save(); }));
  }

  private ctlGcalScope(setting: Setting): void {
    const g = this.plugin.settings.gcal;
    // saved on commit only, so a half-typed folder never becomes the sync scope
    setting.addText((t) => {
      t.setPlaceholder(tr().setDefaultFolderPlaceholder).setValue(g.scopeFolder);
      t.inputEl.addEventListener("change", () => {
        g.scopeFolder = t.getValue().trim();
        this.save();
      });
    });
  }

  private ctlGcalInterval(setting: Setting): void {
    const g = this.plugin.settings.gcal;
    setting.addDropdown((d) => {
      for (const m of [1, 5, 10, 30, 60]) d.addOption(String(m), String(m));
      d.setValue(String(g.pullIntervalMin)).onChange((v) => { g.pullIntervalMin = Number(v); this.save(); });
    });
  }

  private ctlGcalOnDeleted(setting: Setting): void {
    const g = this.plugin.settings.gcal;
    setting.addDropdown((d) =>
      d
        .addOptions({ unlink: tr().gcalUnlinkOption, clearDates: tr().gcalClearDatesOption })
        .setValue(g.onEventDeleted)
        .onChange((v) => { g.onEventDeleted = v as "unlink" | "clearDates"; this.save(); })
    );
  }

  private ctlGcalSyncNow(setting: Setting): void {
    const g = this.plugin.settings.gcal;
    setting.addButton((b) =>
      b.setButtonText(tr().setGcalSyncNow).onClick(() => void (async () => {
        const ok = await syncGcal(this.plugin, { pull: true });
        new Notice(ok ? tr().gcalSyncDone : `⚠️ ${g.lastError || "(console)"}`);
        this.redraw(); // refresh the last-sync time and any error
      })())
    );
  }

  // the sync-now row's description
  private gcalStatusDesc(): string {
    const g = this.plugin.settings.gcal;
    if (g.lastError) return `⚠️ ${g.lastError}`;
    return g.lastSync ? tr().gcalLastSync(new Date(g.lastSync).toLocaleString()) : "";
  }

  // ===== getSettingDefinitions() (@since 1.13.0, declarative settings) =====
  // Used from 1.13 on, where display() is skipped; older versions don't know this method and fall
  // back to display() (the official Path B). Row contents come from the shared ctl* helpers so the
  // two paths can't drift. No 1.13-only runtime API is called from here.
  getSettingDefinitions(): SettingDefinitionItem[] {
    this.declarative = true; // route redraws to update()
    return this.definitions();
  }

  // the setting definitions both renderers draw from
  private definitions(): SettingDefinitionItem[] {
    const s = this.plugin.settings;
    const connected = (): boolean => Platform.isDesktop && isConnected(this.plugin);

    const statusWarn = this.statusGroupWarning();
    const cfWarnings = this.customFieldWarnings();

    const items: SettingDefinitionItem[] = [
      { name: tr().setDefaultFolderName, desc: tr().setDefaultFolderDesc, render: (x) => this.ctlRootFolder(x) },
      { name: tr().setRecurseName, desc: tr().setRecurseDesc, render: (x) => this.ctlRecurse(x) },
      { name: tr().setTemplateName, desc: tr().setTemplateDesc, render: (x) => this.ctlTemplate(x) },
      { name: tr().setDefaultZoomName, render: (x) => this.ctlZoom(x) },
      { name: tr().setDateFormatName, render: (x) => this.ctlDateFormat(x) },
      { name: tr().setMeName, desc: tr().setMeDesc, render: (x) => this.ctlMe(x) },
      { name: tr().setTimezoneName, desc: tr().setTimezoneDesc, render: (x) => this.ctlTimezone(x) },
      { name: tr().setNonWorkingDaysName, desc: tr().setNonWorkingDaysDesc, render: (x) => this.ctlNonWorkingDays(x) },
      { name: tr().setAutoScheduleFSName, desc: tr().setAutoScheduleFSDesc, render: (x) => this.ctlAutoScheduleFS(x) },
      { name: tr().setCardViewName, desc: tr().setCardViewDesc, render: (x) => this.ctlCardView(x) },
      { name: tr().setExecPositionName, render: (x) => this.ctlExecPosition(x) },
      {
        name: tr().setProgressLineColorName,
        desc: tr().setProgressLineColorDesc,
        render: (x) => this.ctlProgressLineColor(x),
      },
      // automatic status by date (right after the general settings, easy to find)
      {
        type: "group",
        heading: tr().setAutoStatusHeading,
        items: [
          { name: tr().setAutoStatusName, desc: tr().setAutoStatusDesc, render: (x) => this.ctlAutoStatus(x) },
          // the targets can be picked while it's off, so the first run already follows them
          { name: tr().setAutoStatusStarted, render: (x) => this.ctlAutoStatusTarget(x, "started") },
          { name: tr().setAutoStatusNotStarted, render: (x) => this.ctlAutoStatusNotStarted(x) },
          { name: tr().setAutoStatusFinished, render: (x) => this.ctlAutoStatusTarget(x, "finished") },
        ],
      },
      // statuses (the list owns add; rows own delete)
      {
        type: "list",
        heading: tr().setStatusesHeading,
        // an empty name keeps the row label out (it would duplicate the id/label fields);
        // the row class goes on inside render, since definitions have no `cls` field.
        // The first entry is the column-header row: with no onDelete, the framework adds no delete
        // buttons at all, so a header sitting among the rows can't be deleted by mistake
        items: [
          { name: "", render: (x) => this.ctlStatusHeader(x) },
          ...s.statuses.map((st): SettingGroupItem => ({
            name: "",
            render: (x) => {
              x.setClass("ogantt-setting-row").setClass("ogantt-status-row");
              this.ctlStatusRow(x, st);
            },
          })),
        ],
        addItem: {
          name: tr().setAddStatus,
          action: () => {
            // the same rule as adding from the legend (a unique id, an unused colour)
            s.statuses.push(newStatus(s.statuses, "New"));
            this.save();
            this.redraw(); // the pre-1.13 settings tab redraws too
          },
        },
      },
      // shown only when the Completed group is empty; right after the list, where it reads in context
      ...(statusWarn
        ? [{ name: "", desc: statusWarn, render: (x: Setting) => { x.setClass("ogantt-setting-warn"); } }]
        : []),
      // custom fields: description, column header, rows; the list owns add, rows own delete
      {
        type: "list",
        heading: tr().setCustomFieldsHeading,
        items: [
          { name: "", desc: tr().setCustomFieldsDesc, render: () => {} },
          ...(s.customFields.length > 0 ? [{ name: "", render: (x: Setting) => this.ctlCustomFieldHeader(x) }] : []),
          ...s.customFields.map((f): SettingGroupItem => ({
            name: "",
            render: (x) => {
              x.setClass("ogantt-setting-row").setClass("ogantt-cf-row");
              this.ctlCustomFieldRow(x, f);
            },
          })),
        ],
        addItem: { name: tr().setAddCustomField, action: () => this.addCustomField() },
      },
      // the advisory, only when there is something to say
      ...(cfWarnings.length > 0 ? [{ name: "", render: (x: Setting) => this.ctlCustomFieldWarning(x, cfWarnings) }] : []),
      // table columns: the shown ones in table order, the hidden ones below
      {
        type: "group",
        heading: tr().setColumnsHeading,
        items: [
          { name: "", desc: tr().setColumnsDesc, render: () => {} }, // without a render the declarative tab skips a nameless row
          ...columnList(allColumns(this.plugin.settings), s.visibleColumns, s.columnOrder).map(({ col, on }, i, list): SettingGroupItem => ({
            name: "",
            render: (x) => this.ctlColumnRow(x, col, on, list[i - 1]?.on === on, list[i + 1]?.on === on),
          })),
        ],
      },
      // tag colors (folder colors via right-click in the table)
      // a headingless item reads as part of the preceding group (statuses), so the default color
      // lives inside a group that carries the "Tag colors" heading
      {
        type: "group",
        heading: tr().setTagColorsHeading,
        items: [
          {
            name: tr().setDefaultTagColorName,
            desc: tr().setDefaultTagColorDesc,
            render: (x) => this.ctlDefaultTagColor(x),
          },
        ],
      },
      {
        type: "list",
        heading: tr().setTagColorsPerTag,
        emptyState: tr().setNoTagColors,
        // deletion lives on the row's own × with a confirm, so the framework's onDelete is not used
        items: this.sortedTagColors().map((tc): SettingGroupItem => ({
          name: "",
          render: (x) => { x.setClass("ogantt-setting-row"); this.ctlTagColorRow(x, tc); },
        })),
        addItem: { name: tr().setAddTagColor, action: () => this.pickTagToColor() },
      },
      // notifications
      // the plan assistant: a chat server on the team's network
      {
        type: "group",
        heading: tr().setAiHeading,
        items: [
          { name: tr().setAiHeading, desc: tr().setAiDesc },
          { name: tr().setAiUrlName, desc: tr().setAiUrlDesc, render: (x) => this.ctlAi(x, "url", "http://ai-server:11434/v1") },
          { name: tr().setAiModelName, desc: tr().setAiModelDesc, render: (x) => this.ctlAi(x, "model", "gpt-oss:20b") },
          { name: tr().setAiKeyName, desc: tr().setAiKeyDesc, render: (x) => this.ctlAiKey(x) },
          { name: tr().setAiCheckName, desc: tr().setAiCheckDesc, render: (x) => this.ctlAiCheck(x) },
          { name: tr().setAiInstructionsName, desc: tr().setAiInstructionsDesc, render: (x) => this.ctlAiArea(x, "instructions", tr().setAiInstructionsPlaceholder) },
          {
            name: tr().setAiAdvancedName,
            desc: tr().setAiAdvancedDesc,
            render: (x) => {
              x.addToggle((t) => t.setValue(this.showAiAdvanced()).onChange((v) => { this.aiAdvanced = v; this.redraw(); }));
            },
          },
          { name: tr().setAiApiName, desc: tr().setAiApiDesc, visible: () => this.showAiAdvanced(), render: (x) => this.ctlAiApi(x) },
          { name: tr().setAiChatPathName, desc: tr().setAiChatPathDesc, visible: () => this.showAiAdvanced(), render: (x) => this.ctlAi(x, "chatPath", AI_PATHS[this.plugin.settings.ai.api]) },
          { name: tr().setAiEmbedModelName, desc: tr().setAiEmbedModelDesc, visible: () => this.showAiAdvanced(), render: (x) => this.ctlAi(x, "embedModel", "bge-m3") },
          { name: tr().setAiEmbedPathName, desc: tr().setAiEmbedPathDesc, visible: () => this.showAiAdvanced(), render: (x) => this.ctlAi(x, "embedPath", "/embeddings") },
          { name: tr().setAiBodyName, desc: tr().setAiBodyDesc, visible: () => this.showAiAdvanced(), render: (x) => this.ctlAiArea(x, "body", '{"max_tokens": 2048}') },
          { name: tr().setAiHeadersName, desc: tr().setAiHeadersDesc, visible: () => this.showAiAdvanced(), render: (x) => this.ctlAiArea(x, "headers", '{"api-key": "{key}"}') },
          { name: tr().setAiTimeoutName, desc: tr().setAiTimeoutDesc, visible: () => this.showAiAdvanced(), render: (x) => this.ctlAiTimeout(x) },
        ],
      },
      {
        type: "group",
        heading: tr().setNotifyHeading,
        items: [
          { name: tr().setNotifyHeading, desc: tr().setNotifyDesc },
          {
            name: "Discord webhook URL",
            desc: tr().setWebhookDesc,
            render: (x) => this.ctlWebhook(x, "discordWebhook", "https://discord.com/api/webhooks/…"),
          },
          {
            name: "Slack webhook URL",
            desc: tr().setWebhookDesc,
            render: (x) => this.ctlWebhook(x, "slackWebhook", "https://hooks.slack.com/services/…"),
          },
          {
            name: "Microsoft Teams webhook URL (Workflows)",
            desc: tr().setWebhookDesc,
            render: (x) => this.ctlWebhook(x, "teamsWebhook", "https://….logic.azure.com/workflows/…"),
          },
          // send-a-test button for instant webhook verification
          { name: tr().setNotifyTestName, action: () => void sendTestNotification(this.plugin) },
          { name: tr().setNotifyStartName, render: (x) => this.ctlNotifyToggle(x, "notifyStart") },
          { name: tr().setNotifyEndName, render: (x) => this.ctlNotifyToggle(x, "notifyEnd") },
        ],
      },
      {
        type: "group",
        heading: tr().setLeadsName,
        items: LEADS.map((lead): SettingGroupItem => ({
          name: leadLabel(lead.id),
          render: (x) => this.ctlLeadToggle(x, lead.id),
        })),
      },
      // Google Calendar sync; rows that only matter once connected are gated with `visible`
      {
        type: "group",
        heading: tr().setGcalHeading,
        items: [
          // mobile can't do loopback auth, so it gets a note instead; one row switches its text, as two rows of one name share a key
          { name: tr().setGcalHeading, desc: Platform.isDesktop ? tr().setGcalDesc : tr().gcalDesktopOnly },
          {
            name: tr().setGcalClientIdName,
            desc: tr().setGcalCredsDesc,
            visible: () => Platform.isDesktop,
            render: (x) => this.ctlGcalClientId(x),
          },
          {
            name: tr().setGcalClientSecretName,
            visible: () => Platform.isDesktop,
            render: (x) => this.ctlGcalClientSecret(x),
          },
          {
            name: tr().setGcalAccountName,
            desc: isConnected(this.plugin) ? tr().gcalStatusConnected : tr().gcalStatusNotConnected,
            visible: () => Platform.isDesktop,
            render: (x) => this.ctlGcalAccount(x),
          },
          { name: tr().setGcalCalendarName, visible: connected, render: (x) => this.ctlGcalCalendar(x) },
          { name: tr().setGcalPushName, visible: connected, render: (x) => this.ctlGcalToggle(x, "pushEnabled") },
          { name: tr().setGcalPullName, visible: connected, render: (x) => this.ctlGcalToggle(x, "pullEnabled") },
          {
            name: tr().setGcalOptInName,
            desc: tr().setGcalOptInDesc(s.keys.gcal),
            visible: connected,
            render: (x) => this.ctlGcalToggle(x, "optInOnly"),
          },
          {
            name: tr().setGcalScopeName,
            desc: tr().setGcalScopeDesc,
            visible: connected,
            render: (x) => this.ctlGcalScope(x),
          },
          { name: tr().setGcalPullIntervalName, visible: connected, render: (x) => this.ctlGcalInterval(x) },
          {
            name: tr().setGcalDeleteEventName,
            visible: connected,
            render: (x) => this.ctlGcalToggle(x, "deleteEventOnTaskDelete"),
          },
          { name: tr().setGcalOnEventDeletedName, visible: connected, render: (x) => this.ctlGcalOnDeleted(x) },
          {
            name: tr().setGcalSyncNow,
            desc: this.gcalStatusDesc(),
            visible: connected,
            render: (x) => this.ctlGcalSyncNow(x),
          },
        ],
      },
      // frontmatter key names
      {
        type: "group",
        heading: tr().setKeysHeading,
        items: (Object.keys(s.keys) as (keyof GanttSettings["keys"])[]).map(
          (k): SettingGroupItem => ({ name: k, render: (x) => this.ctlKeyRow(x, k) })
        ),
      },
    ];
    return items;
  }

  // ===== display(): the fallback for Obsidian older than 1.13 =====
  // From 1.13 on, getSettingDefinitions() renders the tab and this method is never called. It has to
  // stay for 1.12.x while minAppVersion is 1.11.4; the official guide calls this dual setup "Path B".
  // To avoid invoking the deprecated API, redraws go via this.draw(); we never call this.display() ourselves.
  display(): void {
    this.draw();
  }

  // draws the same definitions with classic Settings (only rows, groups and lists are used), so two hand-written paths can't drift
  private draw(): void {
    const el = this.containerEl;
    el.empty();
    const shown = (v?: boolean | (() => boolean)): boolean => (typeof v === "function" ? v() : v ?? true);
    const draw = (d: SettingDefinitionItem, i: number): void => {
      if ("type" in d) {
        if (d.type === "page" || !shown(d.visible)) return;
        if (d.heading) new Setting(el).setName(d.heading).setHeading();
        d.items?.forEach(draw);
        if (d.type !== "list") return;
        const list = d as SettingDefinitionList;
        if (!d.items?.length && list.emptyState) new Setting(el).setDesc(list.emptyState);
        const add = list.addItem;
        if (add) new Setting(el).addButton((b) => b.setButtonText(add.name).onClick(add.action));
        return;
      }
      if (!shown(d.visible)) return;
      const row = new Setting(el).setName(d.name);
      if (d.desc) row.setDesc(d.desc);
      if (d.render) (d.render as (s: Setting) => unknown)(row); // our renders never use the SettingGroup
      const act = d.action;
      if (act) row.addButton((b) => b.setButtonText(d.name).onClick(() => act(i)));
    };
    this.definitions().forEach(draw);
  }
}
