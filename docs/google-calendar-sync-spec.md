# Google Calendar Two-Way Sync Specification

> Status: implemented (not yet released)
> Target version: 2.1.0 (planned)

## Summary

Planned specification for two-way sync between Task Gantt tasks (one Markdown file = one task) and a single user-selected Google Calendar.

- **Push (task → GCal)**: create / update / delete events when in-scope tasks change. **Pull (GCal → task)**: write date/time changes and deletions of plugin-created events back to frontmatter. Each direction can be toggled independently. Out of scope: importing foreign GCal events as tasks, recurring events, multiple calendars, mobile.
- **Auth**: user's own Google Cloud OAuth client (desktop-app type) with a loopback redirect (`http://127.0.0.1:<random port>`, PKCE). Refresh token stored in `data.json` (disclosed in README). Scopes: `calendar.events` + `calendar.calendarlist.readonly`. Desktop-only, guarded by `Platform.isDesktop`.
- **Mapping**: file name → `summary`; date-only → all-day event (exclusive end +1 day); timed → `dateTime` with the plugin's `tz` offset; milestone → one-day all-day event; body excerpt + `obsidian://` link → `description`. The event ID is stored in a new `gcalId` frontmatter key (renamable via `keys`); events carry `extendedProperties.private.taskGantt = "<vault>|<path>"` for identification and pull filtering. Opt-in per task via `gcal: true` (default) or sync the whole scope folder.
- **Engine**: push is triggered by debounced `metadataCache`/vault events plus the existing 1-minute scheduler, with a per-path snapshot (`{id, hash, etag, at}`) so unchanged tasks make no API calls; pull runs every N minutes (default 5) via `events.list` with `syncToken` + `privateExtendedProperty` filter, falling back to a full re-list on `410 Gone`. Titles are never renamed from the GCal side. Event deletion unlinks the task by default (never deletes files).
- **Loop prevention**: pushed etags are recorded and matching pull results are skipped as echoes; pulled writes refresh the local hash so push doesn't re-fire. **Conflicts**: last-writer-wins by comparing the event's `updated` with the local change time, with a Notice.
- **Errors**: 401 → refresh once then mark "reconnect needed"; 403/429 → exponential backoff; offline → retry next tick. Sync failures never block the Gantt itself.
- **New files**: `src/gcal/auth.ts`, `src/gcal/api.ts`, `src/gcal/sync.ts`; additions to settings, i18n, detail panel, scheduler, README. No new dependencies.
- **Milestones**: M1 auth → M2 push → M3 pull/conflicts → M4 polish & release 2.1.0. Unit tests for mapping, diffing, conflict and echo logic; manual matrix for token/syncToken expiry and offline recovery.

## 1. Overview

Task Gantt's tasks (one Markdown file = one task) are synced **both ways** with one Google calendar chosen by the user.

- **Push (task → GCal)**: creating, rescheduling and deleting an in-scope task is reflected as an event.
- **Pull (GCal → task)**: date/time changes and deletions of the events the plugin created are written back to frontmatter.
- Push and Pull are switched ON/OFF separately in settings, so the sync can also be narrowed to one direction (export only / import only).

**Out of scope (not handled in this version)**: turning events created in GCal into tasks, recurring events, syncing several calendars, mobile support.

## 2. Authentication (OAuth 2.0)

There is no server run by the plugin's developer, so the sync uses **the user's own Google Cloud project**.

1. The user enables the Calendar API in GCP and creates an OAuth client (Desktop app type), then enters the client ID / secret in the settings tab.
2. The **Connect** button starts a temporary local HTTP server (`http://127.0.0.1:<random port>`) and opens the consent screen in the default browser (loopback flow, with PKCE).
3. The authorization code is exchanged for tokens, and the refresh token is saved in `data.json`. The access token is kept in memory and refreshed automatically when it expires.

- **Scopes**: `calendar.events` (reading and writing events) + `calendar.calendarlist.readonly` (listing calendars). The full `calendar` scope is not requested.
- **Platform**: the local server relies on Electron, so this is **desktop only**. It is guarded by `Platform.isDesktop`, and on mobile the settings UI says it isn't supported (`isDesktopOnly` in `manifest.json` stays `false`).
- **Disclosures (README)**: what is sent over the network, that the refresh token is stored in plain text in `data.json`, and GCP's "unverified app" warning with the steps for adding yourself as a test user.

## 3. Data model and mapping

### 3.1 Mapping

| Task side | GCal event side |
|---|---|
| File name (without extension) | `summary` |
| `start` / `end` (date only) | All-day event (`end.date` is exclusive, so +1 day) |
| `start` / `end` (with a time) | `dateTime` (with the offset of the `tz` setting) |
| Milestone (`end` only / `milestone: true`) | One-day all-day event |
| The first 500 characters of the body + an `obsidian://open` link | `description` |
| `gcalId` (new frontmatter key, renamable via `keys`) | Event ID (the primary key of the mapping) |
| `gcal: true` (opt-in flag; its key can be renamed too) | — (marks the task for sync) |

- Events get `extendedProperties.private.taskGantt = "<vault name>|<file path>"`, which identifies the events the plugin manages (it is also the Pull filter). The path can go stale through renames and moves, so it is for reference only; the primary key is always `gcalId` ↔ event ID.
- Tasks without dates, and tasks without `gcal: true` (when opt-in is set), are not synced.

### 3.2 Sync state (saved in `data.json`)

```ts
gcal: {
  clientId: string; clientSecret: string;
  refreshToken: string;            // empty = not connected
  calendarId: string;              // the calendar synced to
  pushEnabled: boolean; pullEnabled: boolean;   // default: both true
  scopeFolder: string;             // empty = follow the default folder
  optInOnly: boolean;              // default true (only tasks with gcal: true)
  pullIntervalMin: number;         // default 5 minutes
  deleteEventOnTaskDelete: boolean;   // default true
  onEventDeleted: "unlink" | "clearDates";  // default "unlink" (only removes gcalId)
  syncToken: string;               // for incremental Pull; reset to empty when invalidated
  state: Record<string, {          // path → sync snapshot
    id: string;                    // event ID
    hash: string;                  // hash of the local content at the last sync (name+start+end+times+body excerpt)
    etag: string;                  // the event's etag at the last sync
    at: number;                    // sync time (epoch ms)
  }>;
}
```

## 4. Sync engine

### 4.1 Triggers

- **Push**: `metadataCache.on("changed")` + `vault.on("delete" / "rename")`, debounced by a few seconds and processed as a queue. The existing 1-minute scheduler also sweeps up anything missed.
- **Pull**: an incremental fetch every `pullIntervalMin` (default 5 minutes).
- **Manual**: a **Sync now** button in the settings tab and in the detail panel (runs Push + Pull at once).

### 4.2 Push (task → GCal)

For each in-scope task the current hash is compared with `state[path].hash`, and the API is called only for the tasks that changed.

- **Create**: no `gcalId` → first search by path with `privateExtendedProperty` to make sure there is no duplicate, then `events.insert` → write the returned ID to the frontmatter right away and update `state`.
- **Update**: `gcalId` present and the hash changed → `events.patch`.
- **Delete**: the file is deleted, its dates are removed or it is opted out → `events.delete`, following `deleteEventOnTaskDelete` (a 404 counts as success).
- **Rename/move**: `gcalId` moves with the frontmatter, so it follows automatically. The next Push updates `summary` and the path in the extended property.

### 4.3 Pull (GCal → task)

- `events.list` is fetched incrementally with the `syncToken` + a `privateExtendedProperty=taskGantt...` filter (the filter stays the same from the very first request). On `410 Gone` the token is discarded and everything is fetched again.
- Changed events: the matching task's `start` / `end` (and times) are written back to its frontmatter. A title change is **not written back**, since it would mean renaming the file, which is risky (the README says the next Push restores the task's name).
- `status: "cancelled"` (deleted): follows `onEventDeleted`. The default is to unlink (remove `gcalId` and keep the task). Files are never deleted.

### 4.4 Loop prevention and conflict resolution

- **Loop prevention**: after a Push, the response's `etag` is recorded in `state`. When an event received by Pull has the recorded `etag`, it is skipped as "an echo of our own write". Right after Pull rewrites a frontmatter, `state.hash` is updated too, so Push doesn't fire again.
- **Conflicts (both sides changed since the last sync)**: the event's `updated` is compared with the time the local change was detected, and **the newer one wins** (last-writer-wins). The losing side is overwritten, with a one-line `Notice`.

### 4.5 Error handling

- `401` → refresh the token and retry once. If the refresh fails too, switch to the "reconnect needed" state and show a Notice.
- `403 rateLimitExceeded` / `429` → exponential backoff (up to 3 times), then carried over to the next tick.
- Offline → keep the queue and retry on the next tick. Repeated failures never get in the way of the Gantt itself (the same "catch each one separately" policy as `notify.ts`).
- Several devices (Obsidian Sync etc.): `state` is per device, but the primary key `gcalId` is shared through the frontmatter, so update/delete are idempotent. Create races are mitigated by the pre-insert search in 4.2.

## 5. UI

### 5.1 Settings tab (new "Google Calendar" section)

Client ID / secret, Connect / Disconnect buttons (with the connection status), a calendar dropdown, Push / Pull toggles, the scope folder and the opt-in setting, the Pull interval, the two deletion policies, and **Sync now** with the last sync time and any error.

### 5.2 Detail panel

- A **Sync to Google Calendar** toggle (reads and writes `gcal: true`)
- An **Open in Google Calendar** link on synced tasks (`event.htmlLink`)

### 5.3 i18n

Every string is added to `i18n.ts`, in English.

## 6. Files changed and rough size

| File | Contents | Estimate |
|---|---|---|
| `src/gcal/auth.ts` (new) | Loopback OAuth, storing and refreshing tokens | ~200 lines |
| `src/gcal/api.ts` (new) | Calendar REST wrapper built on `requestUrl` | ~150 lines |
| `src/gcal/sync.ts` (new) | Push queue, incremental Pull, conflict resolution, loop prevention | ~400 lines |
| `src/settings.ts` | `gcal` settings block + settings UI | +150 lines |
| `src/i18n.ts` | English strings | +30 keys |
| `src/view.ts` | Detail panel toggle and link | +60 lines |
| `src/main.ts` | Hooking into the scheduler, event subscriptions | +30 lines |
| `src/model.ts` | Reading and writing the `gcalId` / `gcal` keys | +20 lines |
| `README.md` | Setup steps (an illustrated GCP walkthrough) and disclosures | — |

No new dependencies (both OAuth and REST are built on `requestUrl` and Node's built-in `http`).

## 7. Milestones

1. **M1 Auth**: OAuth loopback + settings UI (connect, choose a calendar)
2. **M2 Push**: create, update, delete; the detail panel toggle
3. **M3 Pull**: incremental fetch with syncToken, conflict resolution, loop prevention
4. **M4 Polish**: i18n, README, edge cases (several devices, offline), release 2.1.0

## 8. Test plan

- Unit tests in `test/`: mapping (all-day +1 day, times + tz, milestones), hash diffing, who wins a conflict, etag echo detection.
- Manual test matrix: create/update/delete × Push/Pull × date only/with times, syncToken expiry (410), token expiry, recovery from offline.
