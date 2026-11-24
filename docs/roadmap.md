# task-gantt Refactoring & Feature Roadmap

> Written: 2026-09-26 / Baseline: 2.9.1 (`ec2e33a`) / Revised: 2026-09-26 (after a code review)
> For hand-off to another agent. Use the vocabulary in `CONTEXT.md` (Task / Board / Group / Subtask / Inline edit / Custom field, etc.).

## 0. Baseline

- Tests: `npm test` → 51 passed / 0 failed. Type check (`tsc -noEmit -skipLibCheck`) is clean.
- The logic layer (`src/model.ts` / `src/timeline.ts` / `src/gcal/map.ts`) is pure and tested.
- The main issue is concentration in `src/view.ts` (2,881 lines): rendering, filter matching, undo, drag & drop, the detail panel, cell editing and popovers all live in one class (`GanttView`).
- `src/i18n.ts` (1,868 lines) holds all 8 languages inline. Missing keys are already type errors via `Record<Lang, Strings>`.
- CI (`.github/workflows/release.yml`) only builds on tag push, using `npm install`; no tests or type check run in CI.
- `obsidian` is `"latest"` in `package.json` (the lock resolves it to 1.13.0).

### Ground rules (all phases)

- Code comments are written in English.
- Refactors must preserve behavior. `npm run build` and `npm test` must pass after each step.
- Permanent spec: every column the table can show supports Inline edit. A new column ships with both its renderer and its editor. The one exception is `name` (click opens the detail panel; renaming lives in the panel title).
- Verify manually by copying the plugin into the local test vault `Obsidian-Dev/` (never committed).
- Roughly one step per PR.

### Recommended order

Phase 1 → Redo (1-5) → Phase 2 (column registry → custom fields) → multi-select & bulk edit → FS auto-scheduling → Phase 3 → Bases view (v3.0)

## Phase 1 (v2.9.x): Foundations and undo fixes

1. **CI**: add `.github/workflows/ci.yml` running `npm ci` → `npm run build` → `npm test` on push to main and on pull requests. Switch `release.yml` from `npm install` to `npm ci` and run `npm test` before building.
2. **Pin dependencies**: pin `obsidian` to `1.13.0`, matching the lock (dropping to 1.7.2 types could break the build). Note the types are newer than `minAppVersion` 1.7.2, so check `@since` before using a new API. Optionally add `eslint` + `eslint-plugin-obsidianmd` and `npm run lint` in CI.
3. **Extract `src/filter.ts`**: move `GanttView.matchFilter` (~L1054) and `processTasks` (~L1091) into pure functions that take statuses, filters, match mode, groupBy, flat and the none-label as arguments.
   - Add `test/filter.test.mjs` covering all text ops, the `""` unset sentinel, unknown status ids as unset, AND/OR, and tag duplication.
   - Wire it into the `test` script and `.gitignore` the generated `test/filter.mjs`.
4. **Undo (highest priority, bug-like)**:
   - `pushUndo` (~L1139) snapshots *every* task file on the board per operation.
   - Not undoable as of 2.9.1: in the detail panel — `saveField` (status, assignee), the progress slider, the GCal sync checkbox, title rename, body edits, tag add/remove; in cells — progress (`commitProgress`), status, assignee, tag add/remove in the popover; plus `createTask` and `deleteTask`. Only dates, dependency add/remove, tag-by-drop and reparent/move are undoable today.
   - Entry shape (implemented): `{ label, files: Map<path, before | null>, moves }`. `null` means "didn't exist before": undoing a create trashes the file, undoing a delete re-creates it at the same path with the same contents (the trashed copy stays in the trash). `moves` are replayed in reverse.
   - Funnel every write through `mutate(label, paths, fn)`. For SS/FF cascades, enumerate the transitive successors *before* writing with a pure, testable `successorClosure(tasks, rootPath)`.
   - Outside renames (file explorer etc.) of this board's tasks or folders are recorded as ops of their own (2.9.3), so undo walks back in order and older entries never hold stale paths; a folder rename's per-file events fold into one entry. This replaced the original path-remapping approach, which undid older ops without undoing the rename. A missing file is re-created only when undoing a delete or redoing a create — never when it was deleted outside the board.
   - Changes made outside Obsidian (Windows Explorer, macOS Finder, sync tools) are out of scope: they reach Obsidian as `delete` + `create`, not `rename`. Guessing renames from such pairs was rejected as too error-prone; the README says so.
   - Acceptance: every inline-edit column, every detail-panel field, rename and create revert with Ctrl/Cmd+Z; per-op reads are limited to affected files; an outside rename is undone by one undo, and the next undo reaches the op before it.
5. **Redo**: on undo, push the current contents of the affected files (and reversed `moves`) onto a redo stack; clear it on any new op. Shortcut Ctrl/Cmd+Shift+Z (and Ctrl+Y). This makes the previously rejected frontmatter-diff command pattern unnecessary.

## Phase 2 (v2.10): Column registry → Custom fields

1. **Column registry**: replace the scattered `ColumnId` / `COLUMN_ORDER` / `OPTIONAL_COLUMNS` / `COLUMN_WIDTHS` (L56–59), `colLabel`, `renderCell`, `paint*Cell` / `edit*Cell` and `taskComparator` with one `ColumnDef { id, label, width, paint, edit?, compare, optional }`. `edit` is required for every column except `name`. Define the `BoardContext` type here (`app`, `settings`, `tasks`, `ppd`, `range`, `mutate`, `refresh`, `rerender`) and pass it to `paint`/`edit`, so Phase 3 doesn't have to rewrite them. Settings keep plain id strings for compatibility.
   - **Done** (`src/columns.ts` / `src/board.ts`), with these changes: `ColumnDef` is a `NameColumn | CellColumn` union — the view draws the name column's tree itself, and only `CellColumn` carries the required `paint` / `edit` / `editAria`. `paint` returning `false` marks a cell read-only (rolled-up dates, a milestone's start); the view attaches editors uniformly. Sorting uses a `sortKey` instead of `compare`; `visibleColumns` / `columnWidth` / `taskComparator` are pure and tested in `test/columns.test.mjs`. `BoardContext` leaves out `ppd` / `range` until a part needs them, and carries the in-cell UI helpers (`inlineInput`, `openPopover`, `openRangePicker`, …) instead. Cell painting and editing moved into `columns.ts`, so Phase 3-1's `cells.ts` is largely done.
2. **Custom field columns** (defined in `CONTEXT.md`, not yet implemented):
   - `GanttSettings.customFields: { key, label, type: "text" | "number" | "date" }[]`, with add/remove UI in the settings tab.
   - Read into `Task.custom` in `collectTasks`.
   - Register as dynamic columns with display, sort and Inline edit (through `mutate`, so undoable); date fields reuse the existing picker.
   - Filters are optional.
   - Add new strings in all 8 languages.
   - **Done** (filters not yet). Changes from the plan: each `CustomField` has a stable `id` and its column id is `cf:<id>`, so renaming the key keeps the column's visibility, width and sort; deleting a field tidies `visibleColumns` / `columnWidths` / `sortBy`. `Task.custom` is keyed by field id; a text list stays an array (shown comma-joined, written back as a list); dates keep the date part only. Fields with an empty key, a key the plugin already reads (`settings.keys` values and `tags`), or a duplicate key don't become columns, and the settings tab says so (`customFieldIssues`). Date editing reuses the range calendar through a new single-date mode (`openRangePicker`'s `single` argument).

## Phase 3 (v2.11): Split view.ts and persist per-board state

1. **Split `src/view.ts`** into `src/view/{GanttView,filterBar,detailPanel,cells,timelineSvg,dnd,popover}.ts`, sharing state through the `BoardContext` from Phase 2-1. Line numbers are approximate as of 2.9.1.
2. **Per-board view state**: `groupBy` / `colorBy` / `flat` / `rollup` / `progressLine` / `showEmptyFolders` / `collapsed` currently last only while the view is open, and filters are one global set. Persist them under `settings.boards[key]` (plus `getState` / `setState`) with keys like `folder:<path>` (leaving room for `base:<id>`), follow folder renames via `vault.on("rename")`, and migrate the current globals as defaults.
   - **Done** (filters excepted): stored under `settings.boards["folder:<path>"]`; a folder rename or move re-keys it in `main.ts`, and an open view follows the folder. The view options were never saved before, so there was nothing to migrate. Filters are still one set shared by every board.
3. **Split i18n** (low priority, optional) into `src/i18n/<lang>.ts`. Missing keys are already type errors, so this is only for readability. (**No longer needed**: the interface is English only, so there is one string table.)

## Phase 4 (v3.0): Larger features

| Priority | Feature | Notes |
|---|---|---|
| A | Multi-select & bulk edit | Shift/Ctrl-click rows; bulk status, assignee, date shift and tags via `mutate` with many paths |
| B | FS auto-scheduling + critical path | FS push and the Duration column are done (issue #4: `src/schedule.ts`, push-only, on by default, workday-based). Still to do: highlight the critical path, building on the existing violation check |
| B | Workload view by assignee | A per-assignee heatmap of daily task counts, drawn from existing assignee data |
| B | Baseline | Save the planned dates in frontmatter and draw them as a faint bar under the current one; pairs with the progress line |
| B | Obsidian Bases view | Offer the Gantt as a Bases custom view, removing the cross-folder limitation in the README. Requires raising `minAppVersion` to 1.10+ |
| C | New task from a template | Per-folder template note; plays well with Templater (**done**: one **Template for new tasks** setting; new note tasks start as a copy of it. Per-folder templates are not done) |
| C | Non-working days | Shade on the timeline; optionally exclude from duration math (**done**: duration math skips the non-working days from settings; Day and Week views shade them) |
| C | Export | PNG / SVG (timeline), CSV (table) |
| C | Virtual scrolling | Cut the full-DOM rebuild cost of `rerender` on large boards, once performance reports come in (**done**: only the rows around the viewport are drawn; at 1,000 tasks the DOM drops from 33,363 to 1,415 nodes and opening the board from 0.7–0.9 s to about 50 ms) |
