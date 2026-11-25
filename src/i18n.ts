// the UI strings, in English (functions where parameterized)

import type { StatusGroup } from "./types";

interface Strings {
  // column headers
  colTask: string;
  colStart: string;
  colDue: string;
  colDuration: string;
  editDuration: string;
  durationDays: (n: number) => string; // duration shown in workdays
  // toolbar
  undoAria: string;
  undoShort: string; // the Undo button in a notice
  undoAnyway: string; // undo even though a note changed since
  redoAnyway: string;
  changedSince: (label: string) => string; // not undone: a note changed since
  writeFailed: string; // some writes failed
  depLoop: string; // dependencies would form a loop
  depRemoved: (type: string) => string; // the notice after removing a dependency
  bodyChangedElsewhere: string; // the body changed elsewhere while it was being edited
  vaultRoot: string; // the board name for the vault root
  reloadAria: string;
  newTaskAria: string;
  today: string;
  // view options
  optGroupLabel: string;
  optGroupFolder: string;
  optColorLabel: string;
  optShowEmpty: string;
  optColumns: string;
  optFlat: string;
  optRollup: string;
  optProgressLine: string;
  noneLabel: string;
  // date filter (start/due); the field names reuse fieldStart/fieldDue, and today reuses today
  dfLabel: string; // filter-row label
  dfAdd: string; // add a filter
  dfRemove: string; // remove a filter
  dfOpIs: string;
  dfOpBefore: string;
  dfOpAfter: string;
  dfOpOnOrBefore: string;
  dfOpOnOrAfter: string;
  dfOpEmpty: string;
  dfOpNotEmpty: string;
  dfYesterday: string;
  dfTomorrow: string;
  dfKindSpecific: string; // specific date
  dfKindRelative: string; // relative date
  dfKindRange: string; // date range
  dfDay: string;
  dfWeek: string;
  dfMonth: string;
  dfAgo: string;
  dfFromNow: string;
  dfRangeTo: string; // range separator
  dfOpIsNot: string; // category "is not"
  dfMatchLabel: string; // "show items matching"
  dfMatchAll: string; // match all
  dfMatchAny: string; // match any
  // filter presets
  presetLabel: string; // presets button
  presetBuiltinHeading: string; // built-in heading
  presetUserHeading: string; // saved heading
  presetNamePlaceholder: string; // preset name
  presetSave: string; // save
  presetClear: string; // clear filters
  presetDelete: string; // delete preset
  presetNoDates: string; // no dates (no bar)
  presetUnassigned: string; // unassigned
  // name (text) filter
  fieldName: string; // Name
  textOpContains: string; // contains
  textOpNotContains: string; // does not contain
  textOpStartsWith: string; // starts with
  textOpEndsWith: string; // ends with
  // status groups (Wrike's four)
  fieldStatusGroup: string; // Status group
  sgActive: string; // Active
  sgCompleted: string; // Completed
  sgDeferred: string; // Deferred
  sgCancelled: string; // Cancelled
  setStatusGroup: string; // the group field in settings
  setNoCompletedStatus: string; // warning when Completed is empty
  presetCompleted: string; // Completed
  // task kinds, icons, colours, assignees (multi-valued)
  newTaskKindAria: string; // new task of a chosen kind
  kindNote: string;
  kindKanban: string;
  kindCanvas: string;
  menuChangeIcon: string;
  menuResetIcon: string;
  searchIcons: string;
  customColor: string;
  addAssigneePlaceholder: string;
  removeAssigneeAria: string;
  confirmDeleteCanvas: (file: string) => string; // its canvas goes too
  confirmDeleteStatus: (label: string, used: number) => string;
  // feedback, dependencies, drops, display
  workingOn: (n: number) => string; // several files being updated
  noMatches: string; // filters hide every task
  linkHint: string; // dependency handle hint
  fieldDeps: string; // the panel's predecessors row
  addDependency: string;
  dropSubtask: (name: string) => string; // what a drop will do
  dropMove: (folder: string) => string;
  headingCount: (o: number, r: number, b: number, l: number, u: number) => string;
  headingAlerts: (r: number, b: number, l: number, u: number) => string; // the problem counts a heading shows
  workdaysUnit: string;
  depFS: string;
  depSS: string;
  depFF: string;
  inLane: (lane: string) => string; // a heading's counts: open, in progress, blocked, overdue, urgent
  nextUp: (n: string, d: string) => string;
  cardsShort: (d: number, t: number) => string;
  allCards: (n: number) => string;
  cardStale: string; // the board changed since the panel drew it and the card isn't there
  setCardViewName: string;
  setCardViewDesc: string;
  setCardViewList: string;
  setCardViewBoard: string;
  setExecPositionName: string;
  setExecPositionTop: string;
  setExecPositionBottom: string;
  nextStep: (n: string) => string; // a parent's next subtask
  nowStep: (n: string) => string; // the kanban card being worked on now
  excResume: string;
  boardCue: string;
  openBoard: string;
  openBoardHint: string;
  attBlocked: string;
  fieldAttention: string;
  presetOverview: string;
  layoutPeople: string; // the layout with one card per person
  presetAttention: string;
  execComplete: (d: number, t: number) => string;
  interruptedBy: (n: string) => string;
  resumeTask: (n: string) => string;
  readOnlyHint: string;
  readOnlyNotice: string;
  readOnlyPanel: string;
  presetUpcoming: string;
  pickInterruptTitle: string;
  pickNone: string;
  fieldPriority: string;
  boardAsMarkdown: string;
  viewIsLocal: string;
  cardsChecked: (d: number, t: number) => string;
  pickInterruptBody: (n: string) => string;
  sharedWith: (n: string) => string;
  attOverdue: (d: string) => string;
  blockerAsk: string; // the blocker field's placeholder and label
  attDependency: (p: string) => string;
  attResume: (n: string) => string;
  attSubtask: (n: string, r: string) => string;
  interruptsWhat: (n: string) => string;
  excUrgent: string; // exception tags
  excOverdue: string;
  excDependency: string;
  excInterrupted: string;
  menuMarkUrgent: string;
  menuClearUrgent: string;
  presetMyWork: string;
  layoutAria: string; // the layout switch (timeline, board, team)
  layoutTimeline: string;
  layoutBoard: string;
  exportTimelineOnly: string; // only the timeline exports
  hideOlder: (n: number) => string;
  hideLater: (n: number) => string;
  olderDone: (n: number) => string; // a board's finished column: show the older cards
  teamNow: string;
  teamNext: string;
  teamMore: (n: number) => string;
  linkedToYou: (names: string) => string; // linked to my work by a dependency
  waitsOnYou: string; // someone else's task waits on mine
  youWaitOn: string; // my task waits on someone else's
  olderHint: (date: string) => string; // the Timeline's folded past work
  sprintHint: string;
  sprintLine: (day: number, days: number, done: number, total: number) => string;
  reportTitle: string; // the status report for a manager (health, headline, sections from the board)
  reportHealth: string;
  healthOnTrack: string;
  healthAtRisk: string;
  healthOffTrack: string;
  healthOnTrackDesc: string;
  healthAtRiskDesc: string;
  healthOffTrackDesc: string;
  reportHeadline: string;
  reportHeadlineHint: string;
  reportCopy: string;
  reportCopied: string;
  reportAttention: string;
  reportProjects: string;
  reportProject: string; // the projects table's first column
  // the plan assistant (an AI chat on the team's own server)
  setAiHeading: string;
  setAiDesc: string;
  setAiUrlName: string;
  setAiUrlDesc: string;
  setAiModelName: string;
  setAiModelDesc: string;
  setAiKeyName: string;
  setAiKeyDesc: string;
  setAiCheckName: string;
  setAiCheckDesc: string;
  setAiCheckButton: string;
  aiChecking: string;
  aiCheckModels: (models: string[]) => string;
  aiCheckNoModel: (model: string, models: string[]) => string;
  aiCheckChat: (model: string, seconds: number) => string;
  aiCheckEmbed: (model: string, size: number) => string;
  aiCheckFailed: (what: string, msg: string) => string;
  aiCheckModelsWhat: string;
  aiCheckChatWhat: string;
  aiCheckEmbedWhat: string;
  aiEmpty: string;
  aiBadJson: (field: string, msg: string) => string;
  setAiInstructionsName: string;
  setAiInstructionsDesc: string;
  setAiInstructionsPlaceholder: string;
  setAiAdvancedName: string;
  setAiAdvancedDesc: string;
  setAiApiName: string;
  setAiApiDesc: string;
  aiApiChat: string;
  aiApiResponses: string;
  setAiChatPathName: string;
  setAiChatPathDesc: string;
  setAiEmbedModelName: string;
  setAiEmbedModelDesc: string;
  setAiEmbedPathName: string;
  setAiEmbedPathDesc: string;
  setAiBodyName: string;
  setAiBodyDesc: string;
  setAiHeadersName: string;
  setAiHeadersDesc: string;
  setAiTimeoutName: string;
  setAiTimeoutDesc: string;
  aiTitle: string;
  aiOpen: string;
  aiAbout: (board: string) => string;
  aiPlaceholder: string;
  aiSend: string;
  aiNew: string;
  aiThinking: string;
  aiSetup: string;
  aiOpenSettings: string;
  aiNoBoard: string;
  aiSuggestions: string[];
  aiProposal: string;
  aiFollows: string;
  aiWaitingFor: string;
  aiApply: string;
  aiDiscard: string;
  aiApplied: (n: number) => string;
  aiDiscarded: string;
  aiBoardClosed: string;
  aiBoardChanged: string;
  aiNotApplied: string;
  aiNoAnswer: string;
  aiUndoLabel: string;
  aiError: (msg: string) => string;
  aiNoTools: string;
  aiTooLong: string;
  aiTimeout: string;
  // the work plan (ת"ע) export
  workPlanExport: string;
  workPlanPick: string;
  workPlanPeriod: (quarter: boolean, n: number, year: number, months: string) => string;
  workPlanFailed: string;
  workPlanEmpty: string;
  laterTodo: (n: number) => string; // a board's open column: show the cards starting later
  teamIdle: string;
  pickRoom: string; // the shared folder a new task goes in
  notShared: string;
  noStatus: string; // the column of cards without a status
  whoAreYou: string; // pick who uses this device
  doneSince: (day: string) => string; // done since the last daily scrum (that weekday)
  stepsSince: (n: number, day: string, cards: string) => string;
  stepsDone: (n: number) => string; // a card's mark: steps done since last time
  setMeName: string;
  setMeDesc: string;
  dropTag: (tag: string) => string;
  dropAssign: (name: string) => string;
  zoomDay: string;
  zoomWeek: string;
  zoomMonth: string;
  zoomFit: string;
  menuMakeSubtask: string;
  menuMoveToFolder: string;
  menuDetach: string;
  close: string;
  previous: string;
  next: string;
  expand: string;
  collapse: string;
  collapseAll: string;
  expandAll: string;
  folderOnly: string; // only when grouped by folder
  optDisplay: string; // the Display menu
  optArrows: string; // show dependency arrows
  optTagLabels: string; // show tags on the bars
  optTimeline: string; // Display menu heading: arrows, tags, progress line
  optRows: string; // Display menu heading: flat, roll up, empty folders
  exportPng: string;
  exportDone: (path: string) => string;
  exportOpen: string;
  exportFailed: string;
  kanbanProgress: (done: number, total: number) => string;
  // undo
  nothingToUndo: string;
  undone: (label: string) => string;
  undoReschedule: (name: string) => string;
  undoSubtask: (name: string) => string;
  undoDetach: (name: string) => string;
  undoAddTag: (name: string, tag: string) => string;
  cycleBlocked: string;
  nameTaken: (name: string) => string;
  undoAddDep: (type: string) => string;
  undoRemoveDep: (type: string) => string;
  undoEdit: (name: string) => string; // a field or body edit
  undoRename: (name: string) => string;
  undoCreate: (name: string) => string;
  undoDelete: (name: string) => string;
  undoRemoveTag: (name: string, tag: string) => string;
  // redo
  redoAria: string;
  nothingToRedo: string;
  redone: (label: string) => string;
  // dependencies
  sfUnsupported: string;
  depTooltip: (type: string) => string;
  // date entry
  pickDate: string;
  editProgress: string;
  editAssignee: string;
  editStatus: string;
  editTags: string;
  removeTagAria: string;
  fieldDates: string;
  fieldTime: string;
  clearDate: string;
  // empty state
  emptyMessage: (folder: string) => string;
  // detail panel
  openAsNote: string;
  fieldStart: string;
  fieldDue: string;
  fieldStatus: string;
  fieldAssignee: string;
  fieldProgress: string;
  fieldParent: string;
  fieldTags: string;
  addTagPlaceholder: string;
  fieldBody: string;
  // delete
  menuDelete: string;
  // color (context menu)
  menuChangeColor: string;
  menuResetColor: string; // folders, back to name-derived
  menuResetTagColor: string; // tags, back to the default colour
  confirmDeleteTitle: string;
  confirmDeleteBody: (name: string) => string;
  confirmDeleteChildren: string;
  cancel: string;
  deletedNotice: (name: string) => string;
  // new task
  newTaskName: string;
  // commands & menus
  ribbonOpen: string;
  commandOpen: string;
  menuOpen: string;
  // settings
  setDefaultFolderName: string;
  setDefaultFolderDesc: string;
  setDefaultFolderPlaceholder: string;
  setTemplateName: string; // the template for new tasks
  setTemplateDesc: string;
  setTemplatePlaceholder: string;
  setRecurseName: string;
  setRecurseDesc: string;
  setDefaultZoomName: string;
  setDateFormatName: string;
  setTimezoneName: string;
  setTimezoneDesc: string;
  setProgressLineColorName: string;
  setProgressLineColorDesc: string;
  setTimezoneSystem: string;
  setNonWorkingDaysName: string;
  setNonWorkingDaysDesc: string;
  setWeekendSatSun: string;
  setWeekendFriSat: string;
  setWeekendSun: string;
  setWeekendNone: string;
  setAutoScheduleFSName: string;
  setAutoScheduleFSDesc: string;
  // notifications
  setNotifyHeading: string;
  setNotifyDesc: string;
  setWebhookDesc: string;
  setNotifyStartName: string;
  setNotifyEndName: string;
  setLeadsName: string;
  leadWeek: string;
  leadDay: string;
  leadHour: string;
  lead10m: string;
  leadNow: string;
  notifyLine: (name: string, kind: "start" | "end", at: string, lead: string) => string;
  setNotifyTestName: string;
  notifyTestMsg: string;
  // Google Calendar
  setGcalHeading: string;
  setGcalDesc: string;
  setGcalClientIdName: string;
  setGcalClientSecretName: string;
  setGcalCredsDesc: string;
  setGcalAccountName: string;
  gcalStatusConnected: string;
  gcalStatusNotConnected: string;
  setGcalConnect: string;
  setGcalDisconnect: string;
  setGcalCalendarName: string;
  setGcalPushName: string;
  setGcalPullName: string;
  setGcalScopeName: string;
  setGcalScopeDesc: string;
  setGcalOptInName: string;
  setGcalOptInDesc: (key: string) => string;
  setGcalPullIntervalName: string;
  setGcalDeleteEventName: string;
  setGcalOnEventDeletedName: string;
  gcalUnlinkOption: string;
  gcalClearDatesOption: string;
  setGcalSyncNow: string;
  gcalLastSync: (at: string) => string;
  gcalSyncDone: string;
  gcalDesktopOnly: string;
  gcalNeedClient: string;
  gcalConnectFailed: string;
  gcalConnectedNotice: string;
  gcalKeptLocal: (name: string) => string;
  gcalKeptRemote: (name: string) => string;
  fieldGcal: string;
  gcalOpenEvent: string;
  setStatusesHeading: string;
  setDeleteTooltip: string;
  setResetTooltip: string;
  setAddStatus: string;
  setStatusId: string;
  setStatusLabel: string;
  setStatusColor: string;
  setTagColorsHeading: string;
  setAddTagColor: string;
  // Custom field / custom fields
  editCustomField: (label: string) => string; // aria label of the cell
  setCustomFieldsHeading: string;
  setCustomFieldsDesc: string;
  setCfKey: string;
  setCfLabel: string;
  setCfType: string;
  cfTypeText: string;
  cfTypeNumber: string;
  cfTypeDate: string;
  setAddCustomField: string;
  setCfEmpty: string; // key is empty
  setCfReserved: (key: string) => string; // clashes with a built-in key
  setCfDuplicate: (key: string) => string; // duplicate
  cfRenameTitle: string; // confirm on key change
  cfRenameBody: (count: number, oldKey: string, newKey: string) => string;
  cfRenameSub: string;
  cfRenameInNotes: string;
  cfRenameSettingOnly: string;
  cfRenamed: (count: number) => string;
  statusIdRenamed: (count: number) => string;
  bodyKeptOnClipboard: string;
  cfRenameSkipped: (count: number, key: string) => string;
  setDefaultTagColorName: string;
  setDefaultTagColorDesc: string;
  setDefaultTagColorAuto: string;
  setTagColorsPerTag: string;
  setNoTagColors: string;
  setNoTagsToColor: string;
  setPickTagPlaceholder: string;
  confirmDropTagColorTitle: string;
  confirmDropTagColorBody: (tag: string) => string;
  confirmDropTagColorSub: string;
  confirmDropTagColorOk: string;
  setKeysHeading: string;
  // column reordering and the settings tab's column list
  colMoveUp: (name: string) => string;
  colMoveDown: (name: string) => string;
  setColumnsHeading: string;
  setColumnsDesc: string;
  setColumnWidth: string;
  setColumnShown: string;
  // automatic status by date
  setAutoStatusHeading: string;
  setAutoStatusName: string;
  setAutoStatusDesc: string;
  setAutoStatusStarted: string;
  setAutoStatusFinished: string;
  setAutoStatusNotStarted: string;
  autoStatusLabel: string; // the undo entry's name
  autoStatusDone: (n: number) => string;
  menuMoveUp: string; // move a row up among its siblings
  menuMoveDown: string;
  menuDisable: string; // disable a task (greyed, listed last)
  menuEnable: string;
  dropReorder: string; // dropping on a row's edge reorders
}

const STRINGS: Strings = {
  colTask: "Task",
  colStart: "Start",
  colDue: "Due",
  colDuration: "Duration",
  editDuration: "Double-click to edit the duration (workdays)",
  durationDays: (n) => `${n}d`,
  undoAria: "Undo (Ctrl+Z)",
  undoShort: "Undo",
  undoAnyway: "Undo anyway",
  redoAnyway: "Redo anyway",
  changedSince: (label) => `Left “${label}” as it is: a note has changed since, and going back would overwrite it.`,
  writeFailed: "Some changes couldn't be saved. Undo puts back the ones that were.",
  depLoop: "Dependencies can't form a loop: these tasks would end up waiting on each other.",
  depRemoved: (type) => `Dependency removed (${type})`,
  bodyChangedElsewhere: "This note changed elsewhere while you were editing it. Your text replaced it; Undo brings that version back.",
  vaultRoot: "Vault root",
  reloadAria: "Reload",
  newTaskAria: "Add task",
  today: "Today",
  optGroupLabel: "Group by",
  optGroupFolder: "Folder",
  optColorLabel: "Color by",
  optShowEmpty: "Show empty folders",
  optColumns: "Columns",
  optFlat: "Flat",
  optRollup: "Roll up",
  optProgressLine: "Progress line",
  noneLabel: "(none)",
  nothingToUndo: "Nothing to undo",
  undone: (label) => `Undone: ${label}`,
  undoReschedule: (name) => `Reschedule “${name}”`,
  undoSubtask: (name) => `Make “${name}” a subtask`,
  undoDetach: (name) => `Detach “${name}”`,
  undoAddTag: (name, tag) => `Tag “${name}” with #${tag}`,
  cycleBlocked: "Can't make a subtask: that would create a cycle",
  nameTaken: (name) => `A task named “${name}” already exists here`,
  undoAddDep: (type) => `Add dependency (${type})`,
  undoRemoveDep: (type) => `Remove dependency (${type})`,
  undoEdit: (name) => `Edit “${name}”`,
  undoRename: (name) => `Rename “${name}”`,
  undoCreate: (name) => `Create “${name}”`,
  undoDelete: (name) => `Delete “${name}”`,
  undoRemoveTag: (name, tag) => `Remove #${tag} from “${name}”`,
  redoAria: "Redo (Ctrl+Shift+Z)",
  nothingToRedo: "Nothing to redo",
  redone: (label) => `Redone: ${label}`,
  sfUnsupported: "SF (start-to-finish) dependencies aren't supported. Connect start→start, finish→start or finish→finish instead.",
  pickDate: "Pick a date",
  editProgress: "Double-click to edit progress",
  editAssignee: "Double-click to edit the assignee",
  editStatus: "Double-click to edit the status",
  editTags: "Double-click to edit tags",
  removeTagAria: "Remove tag",
  fieldDates: "Dates",
  fieldTime: "Time",
  clearDate: "Clear",
  depTooltip: (type) => `${type} dependency — click × to remove`,
  emptyMessage: (folder) => `No tasks (.md) found under “${folder}”.`,
  openAsNote: "Open as note",
  fieldStart: "Start",
  fieldDue: "Due",
  fieldStatus: "Status",
  fieldAssignee: "Assignee",
  fieldProgress: "Progress",
  fieldParent: "Parent",
  fieldTags: "Tags",
  addTagPlaceholder: "Add a tag…",
  fieldBody: "Body",
  menuDelete: "Delete",
  confirmDeleteTitle: "Delete task",
  confirmDeleteBody: (name) => `Delete “${name}”? It will be moved to the trash.`,
  confirmDeleteChildren: "Its subtasks will move to the top level.",
  cancel: "Cancel",
  deletedNotice: (name) => `Deleted “${name}”`,
  menuChangeColor: "Change color…",
  menuResetColor: "Reset color (auto)",
  menuResetTagColor: "Reset to the default color",
  newTaskName: "New task",
  ribbonOpen: "Open Gantt",
  commandOpen: "Open Gantt for the current folder",
  menuOpen: "Open as Gantt",
  setDefaultFolderName: "Default folder",
  setDefaultFolderDesc:
    "Fallback folder used when no folder is selected. Usually you right-click a folder → Open as Gantt, or select a folder and click the ribbon.",
  setDefaultFolderPlaceholder: "e.g. Projects/Cleanup",
  setTemplateName: "Template for new tasks",
  setTemplateDesc: "New note tasks start as a copy of this note, say with Outcome, Done when and Links headings. Keep it outside the boards' folders, or it shows up as a task. Empty: new tasks start empty.",
  setTemplatePlaceholder: "e.g. Templates/Task.md",
  setRecurseName: "Recurse subfolders",
  setRecurseDesc: "Subfolders become groups and the files inside them become tasks.",
  setDefaultZoomName: "Default zoom",
  setDateFormatName: "Date format",
  setTimezoneName: "Timezone",
  setTimezoneDesc: "Timezone (GMT offset) used to display and save times. Changing it converts the display of stored times.",
  setProgressLineColorName: "Progress line color",
  setProgressLineColorDesc: "Color of the line drawn by the Progress line view option.",
  setTimezoneSystem: "System (device setting)",
  setNonWorkingDaysName: "Non-working days",
  setNonWorkingDaysDesc: "Durations and dependency-driven rescheduling count workdays only, skipping these days.",
  setWeekendSatSun: "Saturday & Sunday",
  setWeekendFriSat: "Friday & Saturday",
  setWeekendSun: "Sunday only",
  setWeekendNone: "None (every day is a workday)",
  setAutoScheduleFSName: "Push FS successors automatically",
  setAutoScheduleFSDesc: "When a predecessor slips into an FS (finish→start) successor, move the successor later, keeping its duration.",
  setNotifyHeading: "Notifications (Discord / Slack / Teams)",
  setNotifyDesc: "Sends webhook notifications for the start/due of tasks that have a time of day (only while Obsidian is running; the whole vault is scanned).",
  setWebhookDesc: "Leave empty to disable",
  setNotifyStartName: "Notify on start",
  setNotifyEndName: "Notify on due",
  setLeadsName: "Notification timing",
  leadWeek: "1 week before",
  leadDay: "1 day before",
  leadHour: "1 hour before",
  lead10m: "10 minutes before",
  leadNow: "At the exact time",
  notifyLine: (name, kind, at, lead) => `⏰ ${name} — ${kind === "start" ? "Start" : "Due"}: ${at} (${lead})`,
  setNotifyTestName: "Send a test message",
  notifyTestMsg: "✅ Test notification from Task Gantt",
  setGcalHeading: "Google Calendar",
  setGcalDesc: "Two-way sync between tasks and a Google calendar (desktop only; uses your own Google Cloud OAuth client).",
  setGcalClientIdName: "OAuth client ID",
  setGcalClientSecretName: "OAuth client secret",
  setGcalCredsDesc: "From your Google Cloud project (OAuth client, Desktop app type). See the README for setup.",
  setGcalAccountName: "Account",
  gcalStatusConnected: "Connected",
  gcalStatusNotConnected: "Not connected",
  setGcalConnect: "Connect",
  setGcalDisconnect: "Disconnect",
  setGcalCalendarName: "Calendar to sync",
  setGcalPushName: "Push tasks to Google Calendar",
  setGcalPullName: "Pull changes from Google Calendar",
  setGcalScopeName: "Sync scope folder",
  setGcalScopeDesc: "Leave empty to use the default folder.",
  setGcalOptInName: "Sync flagged tasks only",
  setGcalOptInDesc: (key) => `Only tasks with ${key}: true in their frontmatter are synced. Turn off to sync every dated task in the scope.`,
  setGcalPullIntervalName: "Pull interval (minutes)",
  setGcalDeleteEventName: "Delete the event when its task is deleted",
  setGcalOnEventDeletedName: "When an event is deleted in Google Calendar",
  gcalUnlinkOption: "Unlink the task",
  gcalClearDatesOption: "Unlink and clear the task's dates",
  setGcalSyncNow: "Sync now",
  gcalLastSync: (at) => `Last sync: ${at}`,
  gcalSyncDone: "✅ Synced with Google Calendar",
  gcalDesktopOnly: "Google Calendar sync is desktop-only.",
  gcalNeedClient: "Enter the OAuth client ID and secret first.",
  gcalConnectFailed: "⚠️ Google authorization failed (see console)",
  gcalConnectedNotice: "✅ Connected to Google Calendar",
  gcalKeptLocal: (name) => `⚠️ ${name}: edited on both sides — kept the newer local version`,
  gcalKeptRemote: (name) => `⚠️ ${name}: edited on both sides — kept the newer Google Calendar version`,
  fieldGcal: "Google Calendar",
  gcalOpenEvent: "Open in Google Calendar",
  setStatusesHeading: "Statuses",
  setDeleteTooltip: "Delete",
  setResetTooltip: "Reset to default",
  setAddStatus: "Add status",
  setStatusId: "ID",
  setStatusLabel: "Label",
  setStatusColor: "Color",
  setTagColorsHeading: "Tag colors",
  setAddTagColor: "Add a tag color",
  editCustomField: (label) => `Edit ${label}`,
  setCustomFieldsHeading: "Custom fields",
  setCustomFieldsDesc: "Turn any frontmatter key into a table column. New columns can be shown or hidden from the gear menu and edited by double-clicking.",
  setCfKey: "Key",
  setCfLabel: "Label",
  setCfType: "Type",
  cfTypeText: "Text",
  cfTypeNumber: "Number",
  cfTypeDate: "Date",
  setAddCustomField: "Add field",
  setCfEmpty: "Fields with an empty key are not shown.",
  setCfReserved: (key) => `“${key}” is already used by the plugin, so it can't be a column.`,
  setCfDuplicate: (key) => `“${key}” is listed more than once; only the first becomes a column.`,
  cfRenameTitle: "Rename the property in your notes too?",
  cfRenameBody: (count, oldKey, newKey) => `${count} notes have “${oldKey}”. Rename that property to “${newKey}” in those notes as well?`,
  cfRenameSub: "If you don't, the column reads the new key, so the current values stop showing (they stay in your notes). Notes that already have a value under the new key are never overwritten.",
  cfRenameInNotes: "Rename in notes",
  cfRenameSettingOnly: "Only change the column",
  cfRenamed: (count) => `Renamed the property in ${count} notes`,
  statusIdRenamed: (count) => `Updated the status in ${count} note${count === 1 ? "" : "s"} (Ctrl+Z doesn't undo this)`,
  bodyKeptOnClipboard: "The note was deleted. The text you typed is on the clipboard.",
  cfRenameSkipped: (count, key) => `${count} skipped: they already have a value under “${key}”`,
  setDefaultTagColorName: "Default tag color",
  setDefaultTagColorDesc: "Color used for every tag without a color of its own. Reset it to fall back to Obsidian's own tag color.",
  setDefaultTagColorAuto: "Back to Obsidian's tag color",
  setTagColorsPerTag: "Per-tag colors",
  setNoTagColors: "No tags have a colour yet",
  setNoTagsToColor: "No tags left to colour",
  setPickTagPlaceholder: "Search tags",
  confirmDropTagColorTitle: "Remove tag colour",
  confirmDropTagColorBody: (tag) => `Remove the colour set for “${tag}”.`,
  confirmDropTagColorSub: "The tag goes back to the default colour. This can't be undone.",
  confirmDropTagColorOk: "Remove colour",
  setKeysHeading: "Frontmatter keys",
  dfLabel: "Filters",
  dfAdd: "Add filter",
  dfRemove: "Remove filter",
  dfOpIs: "is",
  dfOpBefore: "is before",
  dfOpAfter: "is after",
  dfOpOnOrBefore: "is on or before",
  dfOpOnOrAfter: "is on or after",
  dfOpEmpty: "is empty",
  dfOpNotEmpty: "is not empty",
  dfYesterday: "yesterday",
  dfTomorrow: "tomorrow",
  dfKindSpecific: "specific date",
  dfKindRelative: "relative date",
  dfKindRange: "date range",
  dfDay: "day",
  dfWeek: "week",
  dfMonth: "month",
  dfAgo: "ago",
  dfFromNow: "from now",
  dfRangeTo: "to",
  dfOpIsNot: "is not",
  dfMatchLabel: "Show items matching",
  dfMatchAll: "Match all",
  dfMatchAny: "Match any",
  presetLabel: "Presets",
  presetBuiltinHeading: "Built-in",
  presetUserHeading: "Saved",
  presetNamePlaceholder: "Preset name…",
  presetSave: "Save",
  presetClear: "Clear filters",
  presetDelete: "Delete preset",
  presetNoDates: "No dates (no bar)",
  presetUnassigned: "Unassigned",
  fieldName: "Name",
  textOpContains: "contains",
  textOpNotContains: "does not contain",
  textOpStartsWith: "starts with",
  textOpEndsWith: "ends with",
  fieldStatusGroup: "Status group",
  sgActive: "Active",
  sgCompleted: "Completed",
  sgDeferred: "Deferred",
  sgCancelled: "Cancelled",
  setStatusGroup: "Group",
  setNoCompletedStatus: "No status belongs to the Completed group, so the Completed preset always comes back empty.",
  presetCompleted: "Completed",
  newTaskKindAria: "New task as…",
  kindNote: "Note",
  kindKanban: "Kanban board",
  kindCanvas: "Canvas",
  menuChangeIcon: "Change icon…",
  menuResetIcon: "Reset icon",
  searchIcons: "Search icons…",
  customColor: "Custom color…",
  addAssigneePlaceholder: "Add an assignee…",
  removeAssigneeAria: "Remove assignee",
  confirmDeleteCanvas: (file) => `Its canvas “${file}” will be deleted too.`,
  confirmDeleteStatus: (label, used) => `Delete the status “${label}”?` + (used ? (used === 1 ? " 1 note uses it. It keeps the value but loses its colour and group." : ` ${used} notes use it. They keep the value but lose its colour and group.`) : ""),
  workingOn: (n) => `Updating ${n} tasks…`,
  noMatches: "No tasks match the current filters.",
  linkHint: "Drag to another bar to link",
  fieldDeps: "Depends on",
  addDependency: "Add dependency…",
  dropSubtask: (name) => `Make subtask of “${name}”`,
  dropMove: (folder) => `Move to “${folder}”`,
  headingCount: (o, r, b, l, u) => [`${o} open`, r ? `${r} in progress` : "", b ? `${b} blocked` : "", l ? `${l} overdue` : "", u ? `${u} urgent` : ""].filter(Boolean).join(" · "),
  headingAlerts: (r, b, l, u) => [r ? `${r} in progress` : "", b ? `${b} blocked` : "", l ? `${l} overdue` : "", u ? `${u} urgent` : ""].filter(Boolean).join(" · "),
  workdaysUnit: "workdays",
  depFS: "FS · after it finishes",
  depSS: "SS · starts with it",
  depFF: "FF · finishes with it",
  inLane: (n) => `Lane: ${n}`,
  nextUp: (n, d) => `next: ${n} ${d}`,
  cardsShort: (d, t) => `${d}/${t} steps`,
  allCards: (n) => `All ${n} steps`,
  cardStale: "The board changed, so it was read again. Check the step once more.",
  setCardViewName: "Kanban cards in the details panel",
  setCardViewDesc: "Checking a card there writes it to the Kanban note.",
  setCardViewList: "Checklist by lane",
  setCardViewBoard: "Side-by-side lanes, like Kanban",
  setExecPositionName: "Steps in the details panel",
  setExecPositionTop: "Right under the title",
  setExecPositionBottom: "After the fields",
  nextStep: (n) => `Next step: ${n}`,
  nowStep: (n) => `Current step: ${n}`,
  excResume: "Resume",
  boardCue: "Steps",
  openBoard: "Open Kanban",
  openBoardHint: "Open execution board",
  attBlocked: "Blocked",
  fieldAttention: "Attention",
  presetOverview: "Overview",
  layoutPeople: "People",
  presetAttention: "Attention",
  execComplete: (d, t) => `${d} of ${t} complete`,
  interruptedBy: (n) => `Interrupted by ${n}`,
  resumeTask: (n) => `Resume ${n}`,
  readOnlyHint: "Read only",
  readOnlyNotice: "You can only read this room (Vault Rooms), so nothing was changed.",
  readOnlyPanel: "You can only read this room (Vault Rooms), so this task can’t be changed here.",
  presetUpcoming: "Upcoming 2 weeks",
  pickInterruptTitle: "What does this interrupt?",
  pickNone: "Don’t link",
  fieldPriority: "Priority",
  boardAsMarkdown: "The Kanban plugin isn’t enabled, so the board opened as Markdown. Each ## heading is a lane; move list items to reorder cards.",
  viewIsLocal: "View settings (grouping, filters, columns, expanded rows) are saved in this device’s plugin settings and aren’t shared. Editing a task changes its note.",
  cardsChecked: (d, t) => `${d} of ${t} steps done`,
  pickInterruptBody: (n) => `${n} has work in progress. Pick the task this urgent work interrupts: it will offer Resume when this is done. Its status and board don’t change.`,
  sharedWith: (n) => ` (shared with ${n})`,
  attOverdue: (d) => `Overdue: due ${d}`,
  blockerAsk: "What is it waiting for?",
  attDependency: (p) => `Waits on ${p}: the dates break the dependency`,
  attResume: (n) => `Ready to resume (finished: ${n})`,
  attSubtask: (n, r) => `Subtask ${n}: ${r}`,
  interruptsWhat: (n) => `Interrupts ${n}`,
  excUrgent: "Urgent",
  excOverdue: "Overdue",
  excDependency: "Date clash",
  excInterrupted: "Interrupted",
  menuMarkUrgent: "Mark as urgent",
  menuClearUrgent: "Clear urgent",
  presetMyWork: "My work",
  layoutAria: "Layout",
  layoutTimeline: "Timeline",
  layoutBoard: "Board",
  exportTimelineOnly: "The export draws the timeline: switch this tab to Timeline first.",
  hideOlder: (n) => `Hide ${n} older`,
  hideLater: (n) => `Hide ${n} later`,
  olderDone: (n) => `Show ${n} older`,
  teamNow: "Now",
  teamNext: "Next",
  teamMore: (n) => `Show ${n} more`,
  linkedToYou: (names) => `Linked to your work: ${names}`,
  waitsOnYou: "waits on you",
  youWaitOn: "you wait on it",
  olderHint: (d) => `Finished before ${d} (the sprint’s start, or two weeks ago)`,
  sprintHint: "The current sprint: a note tagged #sprint (or #ספרינט) whose dates include today (its name carries the goal). Days count workdays (the non-working days in settings are skipped); done counts the whole team’s sprint work, as the Board shows it. Click to open it. The bar fills with the work done; its mark is today.",
  sprintLine: (d, n, done, total) => `day ${d} of ${n} · ${done} of ${total} done`,
  reportTitle: "Status report",
  reportHealth: "How is it going?",
  healthOnTrack: "On track",
  healthAtRisk: "At risk",
  healthOffTrack: "Off track",
  healthOnTrackDesc: "We will meet the goal as planned.",
  healthAtRiskDesc: "We can meet it if a risk is handled.",
  healthOffTrackDesc: "We will miss it unless something changes.",
  reportHeadline: "Headline",
  reportHeadlineHint: "What should your manager know first? Include any ask.",
  reportCopy: "Copy report",
  reportCopied: "Status report copied. Paste it into a note or a message.",
  reportAttention: "Needs attention",
  reportProjects: "Projects",
  reportProject: "Project",
  setAiHeading: "AI assistant",
  setAiDesc: "Chat with the board: ask about projects, tasks and statuses, get summaries, and have changes proposed for you to apply. It talks only to the server set here, an OpenAI-compatible chat server on your network (Ollama, vLLM, llama.cpp), sending it the board's tasks as it looks them up; nothing else leaves this computer.",
  setAiUrlName: "Server URL",
  setAiUrlDesc: "The server's OpenAI-compatible address, usually ending in /v1.",
  setAiModelName: "Model",
  setAiModelDesc: "A model that can call tools, such as gpt-oss:20b or qwen3:14b. Check connection lists the server's models.",
  setAiKeyName: "API key",
  setAiKeyDesc: "Only if the server asks for one. Kept in this computer's secure storage, not in the vault.",
  setAiCheckName: "Check connection",
  setAiCheckDesc: "Asks the server for its models, then tries a short chat with the tools, and the embeddings when set.",
  setAiCheckButton: "Check",
  aiChecking: "Checking…",
  aiCheckModels: (m) => (m.length ? `The server answered; it lists ${m.length === 1 ? "1 model" : `${m.length} models`}: ${m.slice(0, 8).join(", ")}${m.length > 8 ? ", …" : ""}.` : "The server answered; it lists no models."),
  aiCheckNoModel: (model, m) => `The server doesn't list ${model}. It has: ${m.slice(0, 8).join(", ")}${m.length > 8 ? ", …" : ""}.`,
  aiCheckChat: (model, s) => `${model} answered a chat with the tools in ${s.toFixed(1)} s.`,
  aiCheckEmbed: (model, n) => `${model} makes embeddings (${n} numbers each).`,
  aiCheckFailed: (what, msg) => `${what} failed: ${msg}`,
  aiCheckModelsWhat: "The model list",
  aiCheckChatWhat: "The chat",
  aiCheckEmbedWhat: "The embeddings",
  aiEmpty: "an empty answer",
  aiBadJson: (field, msg) => `${field} isn't valid JSON: ${msg}`,
  setAiInstructionsName: "Team instructions",
  setAiInstructionsDesc: "Added after the assistant's built-in instructions: what it can't see on the board, such as your terms, priorities or how to answer. Keep it short: it is sent with every question.",
  setAiInstructionsPlaceholder: "For example: Ops is the infrastructure team. In summaries for management, lead with risks.",
  setAiAdvancedName: "Advanced connection settings",
  setAiAdvancedDesc: "Endpoints, search by meaning (embeddings), extra request fields and headers, and the time limit, for servers set up differently.",
  setAiApiName: "API",
  setAiApiDesc: "How to talk to the server: Chat Completions, which every OpenAI-compatible server offers, or the newer Responses API, which some also offer (OpenAI, vLLM, recent llama.cpp).",
  aiApiChat: "Chat Completions",
  aiApiResponses: "Responses",
  setAiChatPathName: "Chat endpoint",
  setAiChatPathDesc: "A path under the server URL, or a full URL: /chat/completions or /responses, by the API; Ollama's own API is /api/chat.",
  setAiEmbedModelName: "Embeddings model",
  setAiEmbedModelDesc: "Optional. When a search matches no task's words, the assistant finds the closest tasks by meaning, also across Hebrew and English. Use an embeddings model, such as bge-m3 or nomic-embed-text.",
  setAiEmbedPathName: "Embeddings endpoint",
  setAiEmbedPathDesc: "A path under the server URL, or a full URL. OpenAI-compatible servers use /embeddings; Ollama's own API is /api/embed.",
  setAiBodyName: "Extra request fields",
  setAiBodyDesc: 'A JSON object added to every chat request, for options your server takes, such as {"max_tokens": 2048}. It can replace the default temperature (0.2), but not the conversation or the tools.',
  setAiHeadersName: "Extra headers",
  setAiHeadersDesc: 'A JSON object of HTTP headers. Write {key} where the API key goes, as in {"api-key": "{key}"}; without it, the key is sent as a bearer token. Keep secrets in the API key field: these are saved in the vault.',
  setAiTimeoutName: "Time limit",
  setAiTimeoutDesc: "Seconds to wait for each answer before giving up.",
  aiTitle: "Plan assistant",
  aiOpen: "Ask the plan assistant",
  aiAbout: (board) => `About the board “${board}”`,
  aiPlaceholder: "Ask about the plan, or ask for a change…",
  aiSend: "Send",
  aiNew: "New chat",
  aiThinking: "Thinking…",
  aiSetup: "Set the AI server in Settings → Task Gantt → AI assistant.",
  aiOpenSettings: "Open settings",
  aiNoBoard: "Open a board first: the assistant answers about the board you used last.",
  aiSuggestions: ["What needs attention, and why?", "Summarize this sprint for my manager", "Who is working on what?", "Delay the overdue tasks by two workdays"],
  aiProposal: "Proposed changes",
  aiFollows: "follows its dependency",
  aiWaitingFor: "Waiting for",
  aiApply: "Apply",
  aiDiscard: "Discard",
  aiApplied: (n) => `Applied to ${n === 1 ? "1 task" : `${n} tasks`}. Ctrl+Z on the board undoes it.`,
  aiDiscarded: "Discarded.",
  aiBoardClosed: "Not applied: that board has been closed. Open it and ask again.",
  aiBoardChanged: "Not applied: a task in this proposal has changed since (or was renamed or removed). Ask again to get a proposal from how things stand now.",
  aiNotApplied: "Not applied: the board could not write the change.",
  aiNoAnswer: "The model sent an empty answer. Try asking again, or more narrowly.",
  aiUndoLabel: "Changes from the assistant",
  aiError: (msg) => `The AI server answered with an error: ${msg}`,
  aiNoTools: "This model can't call tools, so it can't look at the board. Pick one that can, such as gpt-oss or Qwen 3.",
  aiTooLong: "Stopped after several lookups without an answer. Try asking more narrowly.",
  aiTimeout: "The AI server didn't answer within the time limit. Check that it's running and reachable from this computer, or raise the limit in Settings → AI assistant.",
  workPlanExport: "Export work plan (PPTX)…",
  workPlanPick: "Which period?",
  workPlanPeriod: (quarter, n, year, months) => `${quarter ? "Quarter" : "Half"} ${n}, ${year} (${months})`,
  workPlanFailed: "Couldn't export the work plan",
  workPlanEmpty: "No dated tasks fall in that period, so there is nothing to plan.",
  laterTodo: (n) => `Show ${n} later`,
  teamIdle: "Nothing in progress",
  pickRoom: "Create the task in which shared folder?",
  notShared: "not shared",
  noStatus: "No status",
  whoAreYou: "Which one is you? Your card comes first, and work linked to yours is marked.",
  doneSince: (d) => `Done since ${d}`,
  stepsSince: (n, d, c) => `${n} step${n === 1 ? "" : "s"} done since ${d}: ${c}`,
  stepsDone: (n) => `${n} step${n === 1 ? "" : "s"}`,
  setMeName: "Your name on this device",
  setMeDesc: "The assignee of the “My work” preset; the People layout also puts your card first and marks others’ tasks linked to yours by a dependency. Stored on this device only, never synced.",
  dropTag: (tag) => `Add #${tag}`,
  dropAssign: (name) => `Assign to ${name}`,
  zoomDay: "Day",
  zoomWeek: "Week",
  zoomMonth: "Month",
  zoomFit: "Fit",
  menuMakeSubtask: "Make subtask of…",
  menuMoveToFolder: "Move to folder…",
  menuDetach: "Detach from parent",
  close: "Close",
  previous: "Previous",
  next: "Next",
  expand: "Expand",
  collapse: "Collapse",
  collapseAll: "Collapse all headings",
  expandAll: "Expand all headings",
  folderOnly: "Available when grouped by folder, with Flat off",
  optDisplay: "Display",
  optArrows: "Dependency arrows",
  optTagLabels: "Tags on bars",
  optTimeline: "Timeline",
  optRows: "Rows",
  exportPng: "Export as PNG",
  exportDone: (path) => `Exported to ${path}`,
  exportOpen: "Open",
  exportFailed: "Couldn't export the PNG",
  kanbanProgress: (done, total) => `${done} of ${total} steps done`,
  colMoveUp: (name) => `Move “${name}” up`,
  colMoveDown: (name) => `Move “${name}” down`,
  setColumnsHeading: "Table columns",
  setColumnsDesc: "Shown columns are listed in table order; hidden ones stay below, greyed out. The task name always comes first. Use the arrows to reorder.",
  setColumnWidth: "Width (px)",
  setColumnShown: "Show in the table",
  setAutoStatusHeading: "Automatic status",
  setAutoStatusName: "Update status by date",
  setAutoStatusDesc: "Sets each task's status from its dates, counting today in the Timezone above: before its start date, the first not-started status (To do); from its start through its due date (from its start on, with no due date), the started status (In progress); after its due date, the finished status (Done). Tasks move back too when their dates move. A status already of the right kind stays (another in-progress status, any completed one), and tasks in a deferred or cancelled status, without dates, or disabled are never touched. A status you set by hand, or an Undo, wins: that task is left alone until its dates change. Turning this on aligns every dated task once. Runs when a board opens, when the day changes and after settings are saved; one Undo reverts a run.",
  setAutoStatusStarted: "Started status",
  setAutoStatusFinished: "Finished status",
  setAutoStatusNotStarted: "Counts as not started",
  autoStatusLabel: "Status by date",
  autoStatusDone: (n) => (n === 1 ? "Updated the status of 1 task by date" : `Updated the status of ${n} tasks by date`),
  menuMoveUp: "Move up",
  menuMoveDown: "Move down",
  menuDisable: "Disable task",
  menuEnable: "Enable task",
  dropReorder: "Place here",
};

// the UI strings
export function t(): Strings {
  return STRINGS;
}

// a status group's label, shared across the UI
export function statusGroupLabel(g: StatusGroup): string {
  const s = t();
  switch (g) {
    case "active": return s.sgActive;
    case "completed": return s.sgCompleted;
    case "deferred": return s.sgDeferred;
    case "cancelled": return s.sgCancelled;
  }
}
