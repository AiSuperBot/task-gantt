# Google Tasks Two-Way Sync Specification

> Status: planned (not implemented)
> Target version: not set
>
> Revised 2026-09-27: the M1 (auth) prototype branch `worktree-gtasks-m1-auth` kept the client secret and refresh token in plain text in `data.json`, at odds with 2.10.1 (issue #6), which moved the Google Calendar ones into SecretStorage, so it was discarded. This spec now assumes SecretStorage; implement it the way `src/gcal/secrets.ts` does.

## Summary

Planned specification for two-way sync between Task Gantt tasks (one Markdown file = one task) and a single user-selected Google Tasks **task list**, implemented as a module independent from the existing Google Calendar sync.

- **Push (Task → Google Tasks)**: create / update / complete / delete Google Tasks when in-scope tasks change. **Pull (Google Tasks → Task)**: write due-date changes, completion changes and deletions back to frontmatter. Each direction toggles independently. Out of scope: importing foreign Google Tasks, multiple task lists, subtask hierarchy, dependencies (`after`), start dates, times of day, mobile.
- **Separate module**: `src/gtasks/{auth,api,map,sync}.ts` with its own client ID / secret / refresh token under `plugin.settings.gtasks`, deliberately not merged with `gcal` — this follows the existing per-feature module pattern and spares current Calendar users any migration risk. The same GCP OAuth client can be pasted into both sections, so the extra cost is one more consent screen.
- **Auth**: the user's own GCP OAuth client (desktop type), loopback redirect on `http://127.0.0.1:<random port>/callback` with PKCE, client secret and refresh token stored in **SecretStorage**, never in `data.json` (as `src/gcal/secrets.ts` does since 2.10.1; disclosed in README). Scope is `https://www.googleapis.com/auth/tasks` only — the Tasks API has no read-only counterpart to `calendar.calendarlist.readonly`, so even listing task lists needs the full scope. Desktop-only, guarded by `Platform.isDesktop`.
- **Mapping**: file name → `title`; `end ?? start` (**date only**) → `due`; body excerpt + `obsidian://` link → `notes`; the task id lives in a new `gtasksId` frontmatter key (renamable via `keys`); opt-in per task via `gtasks: true`. **`start` is never synced** (Google Tasks has nowhere to put it) and `due` carries no time of day (Google stores it as UTC midnight), so `startTime` / `endTime` are excluded from the hash entirely.
- **No extended properties**: unlike Calendar events, a Google Task has no arbitrary metadata field and `tasks.list` offers no server-side metadata filter, so the pre-insert duplicate search used by the gcal engine is impossible. The `obsidian://` line in `notes` doubles as the marker, and duplicates are reconciled by an *adopt-on-pull* step that claims unknown remote tasks pointing at an existing path and deletes the extra copy.
- **Pull differs fundamentally from gcal**: the Tasks API has **no `syncToken`/`nextSyncToken`**. Instead every pull passes `updatedMin` (last pull time minus a 60-second safety margin) together with `showCompleted=true`, `showHidden=true` (completed tasks become hidden and would otherwise vanish) and `showDeleted=true`, paging at `maxResults=100` (the Tasks limit, not gcal's 250). Deletions arrive as `deleted: true` rather than `status: "cancelled"`. The first pull omits `updatedMin` and lists the whole task list to adopt what is already there.
- **Status round-trip** (new problem, absent from gcal): Google Tasks only knows `needsAction` / `completed`, while Task Gantt has user-defined statuses each belonging to one of the four fixed status groups. Push maps the *completed* group to `status: "completed"` (with a `completed` timestamp) and every other group — including *cancelled* — to `needsAction`. Pull rewrites the local status **only when the remote state changed since the last sync**, using two new settings: a default completed status (chosen from the completed group) and a default reopen status (chosen from the others).
- **Loop prevention / conflicts**: identical to gcal in shape — a per-path snapshot `{id, hash, etag, done, at}`, debounced push, interval pull, echo detection by `etag`, and last-writer-wins by comparing the remote `updated` with the local mtime (whole-task, never field-by-field). Titles never flow back from the remote side.
- **Deletion policy**: mirrors gcal's `deleteEventOnTaskDelete` / `onEventDeleted`, named `deleteRemoteOnTaskDelete` / `onRemoteDeleted` (`"unlink" | "clearDates"`, default unlink; files are never deleted).
- **Detail panel**: an opt-in toggle only. No "open in browser" link in v1 — note that the original assumption was wrong, the Task resource *does* expose an output-only `webViewLink`, so the value is merely stored in the snapshot and surfacing it is deferred.
- **New files**: `src/gtasks/{auth,api,map,sync}.ts` plus additions to settings (~200 lines), i18n (~34 English keys), detail panel, scheduler and README. No new dependencies (`requestUrl` + Node's `http` only).
- **Milestones**: M1 auth → M2 push → M3 pull/conflicts → M4 status round-trip & settings UI → M5 polish and the next minor release. Unit tests build `src/gtasks/map.ts` with esbuild into `test/gtasks.test.mjs` (added to the `test` script) covering due mapping, hashing, completion mapping, the pull status branches, conflict outcomes, echo detection and `updatedMin` computation.

## 1. Overview

Task Gantt's Tasks (one Markdown file = one Task) are synced **both ways** with one Google Tasks **task list** chosen by the user. It is implemented as a **module independent** of the existing Google Calendar sync (`docs/google-calendar-sync-spec.md`), and shares no settings, authentication or sync state with it.

- **Push (Task → Google Tasks)**: creating an in-scope Task, changing its due date, completing or reopening it and deleting it are reflected as a Google Task.
- **Pull (Google Tasks → Task)**: due-date changes, completion changes and deletions of the Google Tasks the plugin created are written back to frontmatter.
- Push and Pull are switched ON/OFF separately in settings, so the sync can also be narrowed to one direction.

**Why a separate module**: the plugin is organized as "one independent module per feature" (`notify.ts` / `gcal/`), and existing Google Calendar users must not be exposed to a settings migration or to getting their tokens again, so a new `src/gtasks/` sits alongside it. Users can reuse the same GCP OAuth client by pasting its Client ID / Client Secret into both sets of fields, so the only real extra cost is going through the consent screen once more.

**Out of scope (not handled in this version)**: turning tasks created in Google Tasks into Tasks, syncing several task lists, syncing the Subtask (parent/child) hierarchy, syncing Dependencies (`after`), recurring tasks, syncing the start date (`start`), mobile support.

## 2. Authentication (OAuth 2.0)

There is no server run by the plugin's developer, so the sync uses **the user's own Google Cloud project** (the same approach and the same code structure as gcal).

1. The user enables the Tasks API in GCP and creates an OAuth client (Desktop app type), then enters the client ID / secret in the **Google Tasks** section of the settings tab (separate from the gcal fields).
2. The **Connect** button starts a temporary local HTTP server (`http://127.0.0.1:<random port>/callback`) and opens the consent screen in the default browser (loopback flow, with PKCE S256, `state` verification and a 3-minute timeout).
3. The authorization code is exchanged for tokens, and the refresh token is saved in **SecretStorage** (so is the client secret; neither goes in `data.json`, the same approach as `src/gcal/secrets.ts`). The access token is only kept in memory and is refreshed automatically when it expires (`access_type=offline` + `prompt=consent`).

- **Scope**: `https://www.googleapis.com/auth/tasks` only. The Google Tasks API has no read-only scope matching Calendar's `calendar.calendarlist.readonly`, and **even listing task lists needs the same full scope**, so the scope can't be narrowed. The README says so too (explaining why it asks for wider access than gcal).
- **Platform**: the loopback server relies on Electron, so this is **desktop only**. It is guarded by `Platform.isDesktop`, and on mobile the settings UI only says it isn't supported (`isDesktopOnly` in `manifest.json` stays `false`).
- **When connecting fails**: the `error_description` / `error` returned by Google is shown as is in a Notice and kept in `lastError` (`redirect_uri_mismatch` and `invalid_client` need completely different fixes, and a generic message alone can't tell them apart without opening the console).
- **Disconnecting**: the refresh token is revoked (best effort), and the refresh token in SecretStorage and `state` / `lastPullAt` / `lastError` are cleared.
- **Disclosures (README)**: what is sent over the network; that the client secret and refresh token are stored in SecretStorage and never left in `data.json`; that the `tasks` scope covers both reading and writing; and GCP's "unverified app" warning with the steps for adding yourself as a test user.

## 3. Data model and mapping

Terms follow `CONTEXT.md`. To avoid confusion, this document calls the plugin's side a **Task**, the remote side a **Google Task**, and the list synced to the **task list**.

### 3.1 Mapping

| Task side | Google Task side |
|---|---|
| File name (without extension) | `title` |
| `end ?? start` (**date only**) | `due` |
| The first 500 characters of the body + an `obsidian://open` link | `notes` |
| The Status group of the Status (completed / anything else) | `status` (`completed` / `needsAction`) + `completed` |
| `gtasksId` (new frontmatter key, renamable via `keys`) | The Google Task's `id` (the primary key of the mapping) |
| `gtasks: true` (opt-in flag; its key can be renamed too) | — (marks the Task for sync) |

**Explicit constraints on dates**:

- Google Tasks' `due` is exchanged as RFC3339, but **Google keeps only the date part and always stores it as UTC midnight**. So `startTime` / `endTime` (times of day) are not used for sync. Push sends it as `YYYY-MM-DDT00:00:00.000Z`.
- **`start` (the start date) is not synced**, since Google Tasks has nowhere to put a start date. For a Task with a date range, only `end` (the due date) carries over, one way, as `due`; a Task without `end` sends its `start` as the due date (`end ?? start`). When `due` changes on Pull, `start` is never rewritten.
- Tasks with no date at all, and Tasks without `gtasks: true` (when opt-in is set), are not synced.
- **`due` is never set back to empty.** A Task whose due date disappears is treated as "no longer in sync scope" and left to the deletion policy (4.2). How `due: null` is handled varies a lot between API implementations, and a half-emptied Google Task left behind would make the next Pull unpredictable.

**An important difference from gcal in identifying tasks**:

- The Google Tasks Task resource has **no free metadata area** like gcal's `extendedProperties.private`. So "which vault and path does this Google Task belong to" can't be kept in structured form on the remote side.
- Instead, one line `obsidian://open?vault=<vault name>&file=<path>` is added at the end of `notes`. It is a link for people and, at the same time, what Pull uses to decide on **adopting** a task (4.3).
- However, `tasks.list` has **no server-side filter on metadata**, so gcal's "duplicate check just before creating", done with a `privateExtendedProperty` search, isn't possible. Double creation across several devices is resolved by adopting on the Pull side (4.3, 4.4).
- The primary key is always `gtasksId` ↔ the Google Task's `id`. The path in `notes` can go stale through renames and moves, so it is for reference only.

### 3.2 Sync state (saved in `data.json`, secrets excluded)

```ts
gtasks: {
  clientId: string;
  // clientSecret / refreshToken live in SecretStorage, never here (the policy since 2.10.1)
  taskListId: string;              // the task list synced to
  taskListName: string;            // for display
  pushEnabled: boolean; pullEnabled: boolean;   // default: both true
  scopeFolder: string;             // empty = follow the default folder
  optInOnly: boolean;              // default true (only Tasks with gtasks: true)
  pullIntervalMin: number;         // default 5 minutes
  deleteRemoteOnTaskDelete: boolean;         // default true
  onRemoteDeleted: "unlink" | "clearDates";  // default "unlink" (only removes gtasksId)
  statusSyncEnabled: boolean;      // default true (status round-trip ON/OFF)
  completedStatus: string;         // the default completed status (a Status id in the Completed group)
  reopenStatus: string;            // the default reopen status (a Status id outside Completed)
  lastPullAt: number;              // reference time of the incremental Pull (epoch ms); stands in for gcal's syncToken
  lastSync: number;                // last successful sync (epoch ms)
  lastError: string;               // the latest error (shown in the settings tab)
  state: Record<string, {          // path → sync snapshot
    id: string;                    // the Google Task's id
    hash: string;                  // hash of the local content at the last sync (name+due date+completion+body excerpt)
    etag: string;                  // the Google Task's etag at the last sync (echo detection)
    done: boolean;                 // the remote completion state at the last sync (the basis of the status round-trip)
    at: number;                    // sync time (epoch ms)
    link?: string;                 // the Google Task's webViewLink (only stored; see 5.2)
  }>;
}
```

`gtasksId` / `gtasks` are added to the frontmatter key settings (`keys`), with defaults of the same names. `loadSettings()` merges with the defaults and makes a shallow copy of `state`, as it does for gcal.

## 4. Sync engine

### 4.1 Triggers

- **Push**: `metadataCache.on("changed")` + `vault.on("delete" / "rename")`, debounced by 5 seconds and processed as a queue (the same shape as gcal's `schedulePush`; both modules are scheduled independently from the same events).
- **Pull**: an incremental fetch every `pullIntervalMin` (default 5 minutes), decided inside the existing 1-minute scheduler by looking at `lastGtasksPull` (alongside gcal's `lastGcalPull`).
- **Manual**: the **Sync now** button in the settings tab and the command `Google Tasks: Sync now` (runs Push + Pull at once).
- The in-progress guard (`running` / `rerun`) has the same shape as gcal's. A failing sync never gets in the way of drawing or editing the Board itself.

### 4.2 Push (Task → Google Tasks)

For each in-scope Task the current hash is compared with `state[path].hash`, and the API is called only for the Tasks that changed. The hash covers **the name, the due date (the date of `end ?? start`), whether it is completed, and the body excerpt**. Changing `start` alone, or a time of day (`startTime` / `endTime`), leaves the hash unchanged and makes no API call (the flip side of the constraints in 3.1).

- **Create**: no `gtasksId` → create a new Google Task → write the returned `id` to the frontmatter right away and update `state`. Unlike gcal, there can be no server-side duplicate search before creating (3.1), so duplicates are detected and resolved by adopting on the Pull side.
- **Update**: `gtasksId` present and the hash changed → a partial update. If the remote answers 404 / 410 (deleted by hand), it is created again.
- **Completed/not completed**: `status` and `completed` are sent together, following the rules in 4.6.
- **Delete**: the file is deleted, its due date is removed, it is opted out or it moves out of scope → the Google Task is deleted following `deleteRemoteOnTaskDelete` (404 / 410 count as success). In every case but a deleted file (out of scope, opted out, due date removed), it is always removed from the remote, whatever the setting. When the file still exists, its `gtasksId` is removed too.
- **Rename/move**: `gtasksId` moves with the frontmatter, so it follows automatically. The `state` key is moved and its hash emptied, so the next Push updates `title` and the path in `notes`.

### 4.3 Pull (Google Tasks → Task): fundamentally different from gcal

**The Google Tasks API's `tasks.list` has no incremental sync mechanism like Calendar's `syncToken` / `nextSyncToken`.** gcal's implementation (store the `syncToken`, fall back to a full re-fetch on `410 Gone`) **must not be ported as it is**. The following approach is used instead.

- Every request carries the following, to fetch "every Google Task changed since the last Pull".
  - `updatedMin` = `lastPullAt` minus a safety margin (60 seconds), as RFC3339. It deliberately leans a little into the past, to cover clock drift between the device and the server and misses at the boundary. Fetching something twice is harmless thanks to the etag echo detection and the hash comparison.
  - `showCompleted=true` + `showHidden=true`: in Google Tasks, a task that was completed becomes `hidden` and drops out of the list without `showHidden`. Both are required for the completion round-trip (4.6) to work.
  - `showDeleted=true`: deleted tasks come back flagged `deleted: true` (the counterpart of gcal's `status: "cancelled"`).
  - `maxResults=100` (the Tasks API's per-page limit) + `pageToken`, walking every page. Note that the limit differs from gcal's 250.
- **The first Pull** (`lastPullAt` is 0) omits `updatedMin` and fetches the whole task list, as a chance to adopt the Google Tasks already there.
- Once every page has been fetched, `lastPullAt` is set to **the time the request started** (the time the response finished would drop changes made in between). If an error ends it early, it isn't updated.
- Switching the task list, and disconnecting, reset `lastPullAt = 0` + `state = {}`.

Handling each fetched Google Task:

1. Find the matching path by a reverse lookup of the `id` in `state`. If there is none, read the `obsidian://open?vault=<this vault>&file=<path>` in `notes`, and if a Task really exists at that path and is in sync scope, **adopt** it. Adopting creates a `state` entry and writes `gtasksId` to the frontmatter. This is the only path that resolves double creation across devices and "links made by another device" (in place of gcal's search before creating).
2. `deleted: true` → follow `onRemoteDeleted`. The default is to unlink (remove `gtasksId` and keep the Task itself). Files are never deleted.
3. `etag` matches `state[path].etag` → skipped as an echo of our own write (4.4).
4. If `due` changed, write it back to the `end` frontmatter. When the local value has a time (`endTime`), **only the date is replaced and the time is kept** (Google has no times, so clearing the time would lose information that exists on one side only, every time). `start` is not rewritten.
5. If `status` changed since the last sync (`state[path].done`), rewrite the Status following 4.6.
6. `title` is **not written back** (it would mean renaming the file, which is risky). If the name changed on the remote side, the hash is emptied so the next Push restores the Task's name (the README says so).
7. If `due` has gone from the remote, the local date is not cleared; the hash is emptied so the next Push restores the due date (never erring towards the destructive side).

The paths Pull rewrote are left out of the Push in the same tick (`metadataCache` may still be stale, so they wait for the next tick).

### 4.4 Loop prevention and conflict resolution

- **Loop prevention**: after a Push, the response's `etag` is recorded in `state`, and a Google Task received by Pull with the recorded `etag` is skipped as "an echo of our own write". Right after Pull rewrites a frontmatter, `state.hash` and `state.done` are updated too, so Push doesn't fire again.
- **Conflicts (both sides changed since the last sync)**: the Google Task's `updated` is compared with the local file's mtime, and **the newer one wins** (last-writer-wins). The losing side is overwritten, with a one-line `Notice`. The due date and the status are never merged separately (users can't predict the outcome of a field-by-field mixed merge, so the winner is decided per Task).
- **Resolving duplicates**: when several Google Tasks end up existing for the same path (created at the same time on several devices), the `id` recorded in `state` is the right one; when adopting finds a Google Task with another `id`, **the one adopted later is deleted**, back to one-to-one. It is deleted whatever `deleteRemoteOnTaskDelete` says (a duplicate isn't something the user meant).

### 4.5 Error handling

- `401` → force a token refresh and retry once only. If the refresh fails too (`invalid_grant`), drop the connection details and show "reconnect needed" in the settings tab and in a Notice.
- `403 rateLimitExceeded` / `429` → exponential backoff (up to 3 times), then carried over to the next tick.
- `400` (an invalid `due`, for instance) → skip only that Task, keep the error in `lastError`, and go on syncing the other Tasks.
- Offline → keep the queue and retry on the next tick. Repeated failures never get in the way of the Board (the same "catch each one separately" policy as `notify.ts`).
- Several devices (Obsidian Sync etc.): `state` is per device, but the primary key `gtasksId` is shared through the frontmatter, so update / delete are idempotent. Create races settle through adopting (4.3) and resolving duplicates (4.4).
- For a Task synced to both gcal and Google Tasks, a write-back by one side's Pull can trigger the other side's Push. Both settle within one round trip thanks to the hash comparison, so there is no infinite loop, but it is an edge case included in M5's manual tests.

### 4.6 Status round-trip

A Google Task's state has **only two values**, `needsAction` / `completed`. The plugin's Statuses, on the other hand, are user-defined, and each belongs to one of the four fixed Status groups (Active / Completed / Deferred / Cancelled) (`CONTEXT.md`). This asymmetry is resolved as follows.

**Push (Task → Google Tasks)**

- The Task's Status is in the **Completed** group → send `status: "completed"` + `completed` (the completion time). `completed` gets the time of the Push (Google's completion time means "when it was marked complete", a different concept from the due date, so `end` isn't used).
- **Every other group (Active / Deferred / Cancelled), plus no Status or a Status id that isn't in the settings** → `status: "needsAction"`, with `completed` explicitly emptied.
  - Why Cancelled isn't mapped to `completed`: in Google Tasks it would read as "done", contradicting the facts. The notion of a dropped task stays local truth.
- Whether a Task is completed is decided by **the Status group alone**, never guessed from a Status's id or label (the rule in `CONTEXT.md`).

**Pull (Google Tasks → Task)**

- The remote `status` is compared with `state[path].done` (the completion state at the last sync), and the local Status field (the actual Status value, not the Status group) is rewritten **only when it changed**. When it hasn't, the Status is left completely alone (so the specific Status a user picked within the Completed group isn't flattened on every sync).
  - Changed from not completed → completed → `keys.status` is set to **`completedStatus` (the default completed status)**.
  - Changed from completed → not completed → `keys.status` is set to **`reopenStatus` (the default reopen status)**.
- When `statusSyncEnabled` is false, nothing is rewritten and only the record in `state[path].done` is updated (so that turning it back to true doesn't apply all the past changes at once).
- Setting defaults: `completedStatus` is the first Status in the Completed group, `reopenStatus` the first Status outside Completed. If a configured Status id has disappeared from the Status definitions, it falls back by the same rule and the settings tab shows a warning. If no Status is defined in the Completed group, the status round-trip is disabled automatically and the settings tab says so.

## 5. UI

### 5.1 Settings tab (new "Google Tasks" section)

Added right after the existing "Google Calendar" section, in the same order and with the same structure. Each row gets a `ctlGtasks*` helper shared by both `display()` and `getSettingDefinitions()` (as for gcal, so the two don't drift apart from being maintained twice). On mobile only the heading and a not-supported note are shown, and while not connected, the rows below the credentials aren't drawn.

| Row | Contents |
|---|---|
| Client ID / client secret | The secret is a masked input |
| Account | Connect / Disconnect buttons + connection status |
| Task list | Picked from the `tasklists.list` results (filled in asynchronously). Changing it resets `state` and `lastPullAt` |
| Push / Pull | One toggle each |
| Opt-in | Toggle: sync only the Tasks that have `gtasks: true` |
| Scope folder | Empty = the default folder |
| Pull interval | 1 / 5 / 10 / 30 / 60 minutes |
| Delete remotely when a Task is deleted | Toggle |
| When deleted remotely | Unlink / Also clear dates |
| Sync statuses | Toggle (ON by default) |
| Default completed status | Picked from the Statuses in the Completed group |
| Default reopen status | Picked from the Statuses outside the Completed group |
| Sync now | Button + last sync time / latest error |

### 5.2 Detail panel

- A **Sync to Google Tasks** toggle (reads and writes `gtasks: true`). Shown only when connected with a task list chosen, and shown as disabled while the opt-in setting is OFF (the same behavior as the gcal toggle).
- **No "Open in browser" link** (a difference from gcal). The original assumption, "Google Tasks has no counterpart to `htmlLink`", turned out **wrong** on checking the API spec: the Task resource has `webViewLink` (output only, an absolute link into the Google Tasks web UI). Still, the v1 scope keeps to not adding more ways out of the detail panel, and the value is only kept in `state[path].link`. Showing it in the UI is an optional item for M5 or later, falling back to a plain link to `https://tasks.google.com/` for a Google Task whose `webViewLink` is empty.

### 5.3 i18n

Every string is added to `i18n.ts`, in English. Compared with gcal's 32 keys, the task list choice, the three status round-trip rows and the scope note are added and "Open in browser" goes, so about 34 keys. The existing gcal keys aren't reused; they are defined as separate `gtasks*` keys (otherwise the wording couldn't differ).

## 6. Files changed and rough size

Estimates based on the actual size of the current codebase (2.9.1). Figures in parentheses are current line counts.

| File | Contents | Estimate |
|---|---|---|
| `src/gtasks/auth.ts` (new) | Loopback OAuth; storing, refreshing and disconnecting tokens | ~210 lines (`gcal/auth.ts` is 243 lines; almost the same shape, differing in scope and wording) |
| `src/gtasks/api.ts` (new) | Tasks REST wrapper built on `requestUrl` (`tasklists.list` / `tasks.list` / `insert` / `patch` / `delete`) | ~140 lines (`gcal/api.ts` is 134 lines) |
| `src/gtasks/map.ts` (new) | Pure conversions and hashing for the due date, `notes` and completion state; the status round-trip branches | ~130 lines (`gcal/map.ts` is 104 lines) |
| `src/gtasks/sync.ts` (new) | Push queue, incremental Pull with `updatedMin`, adopting, conflict resolution, loop prevention | ~380 lines (`gcal/sync.ts` is 335 lines; adopting and the status round-trip add to it) |
| `src/settings.ts` (911 lines) | `gtasks` settings block, 13 `ctlGtasks*` rows, `drawGtasks`, additions to `getSettingDefinitions` | about +200 lines |
| `src/i18n.ts` | about 34 English keys | about +70 lines |
| `src/view.ts` (2881 lines) | The detail panel toggle (smaller than gcal's, since there is no link) | about +40 lines |
| `src/main.ts` (165 lines) | Scheduler branch (`lastGtasksPull`), command registration, merging in `loadSettings` | about +25 lines |
| `test/gtasks.test.mjs` (new) | Unit tests for `src/gtasks/map.ts` | ~150 lines |
| `package.json` | One build and one run added to the `test` script | +2 commands |
| `README.md` | Setup steps (GCP, enabling the Tasks API) and disclosures; that `start` and times of day aren't synced | — |

`src/types.ts` doesn't change (the settings types live in `settings.ts`, as for gcal). No new dependencies either (both OAuth and REST use only `requestUrl` and Node's built-in `http`).

## 7. Milestones

1. **M1 Auth**: `gtasks/auth.ts` + `tasklists.list` in `gtasks/api.ts`, up to connecting, disconnecting and choosing the task list in the settings UI.
2. **M2 Push**: create, update, delete; writing `gtasksId`; the detail panel toggle; skipping unchanged Tasks by hash.
3. **M3 Pull / conflict resolution**: incremental fetch with `updatedMin`, handling `deleted`, adopting, etag echo detection, last-writer-wins.
4. **M4 Status round-trip and settings UI**: the Push / Pull branches of 4.6, the setting rows for the default completed / reopen statuses, `statusSyncEnabled`.
5. **M5 Polish**: the English strings, README (disclosures and constraints spelled out), edge cases (several devices, offline, use alongside gcal, switching task lists), the next minor release.

Syncing the Subtask hierarchy (`parent` / `position` / `move`) is held back as **a future milestone (not started)**. Google Tasks' reordering API relies on opaque, lexicographically ordered `position` strings and a `move` endpoint that names "the previous sibling's ID", which is much riskier and costlier than syncing due dates and titles, so v1 is flat.

## 8. Test plan

The `test` script in `package.json` gains a step that bundles `src/gtasks/map.ts` with esbuild into `test/gtasks-map.mjs`, and a run of `node test/gtasks.test.mjs` (`obsidian` is aliased to the existing `test/obsidian-stub.mjs`). Testing `map.ts`, which gathers the pure functions, rather than `sync.ts` with its side effects, follows the same policy as gcal.

Unit tests (`test/gtasks.test.mjs`):

- **Due-date mapping**: choosing `end ?? start`, `end` only / `start` only, the time being dropped from a value with a time, the sent form being UTC midnight.
- **Sync scope**: a Task without dates is left out.
- **Building `notes`**: the body excerpt comes first, `obsidian://open?vault=...&file=...` is appended, and it is cut at 500 characters.
- **Hash diffing**: it changes with the name, the due date, the completion state and the body, and **doesn't** change with `start` (when there is an `end`) or `startTime` / `endTime`.
- **Completion mapping (Push)**: Completed group → `completed` + completion time; Active / Deferred / **Cancelled** / unset / unknown id → `needsAction` with no completion time.
- **Status round-trip (Pull)**: `done` unchanged → the Status isn't rewritten; false→true → `completedStatus`; true→false → `reopenStatus`; the fallback when the setting is empty or names an id that doesn't exist; disabling when the Completed group has no Status.
- **Conflict outcome**: comparing `updated` with the mtime (local wins / remote wins / same time).
- **Echo detection**: skipped when the `etag` matches, processed when it doesn't.
- **Deletion detection**: a Google Task with `deleted: true` is treated as deleted.
- **Computing `updatedMin`**: it is RFC3339 for `lastPullAt` minus the safety margin, and is left out on the first Pull (0).

Manual test matrix: create / update / delete × Push / Pull; completed → not completed → completed round trips; adopting a task completed and then "cleared" in the Google Tasks web UI (now `hidden`); switching task lists; token expiry and reconnecting; recovery from offline; a Task synced with gcal at the same time; simultaneous edits on several devices.
