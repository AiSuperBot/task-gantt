---
status: accepted
---

# A fixed four-group layer above statuses

Statuses were a flat list of "id / label / color", and **the app didn't know which of them meant done**. So the most basic filters, "Completed" and "Incomplete", couldn't be built. One layer, the **Status group**, is added above Status, with **four fixed groups**, the same as Wrike's (`active` / `completed` / `deferred` / `cancelled`). Every Status belongs to exactly one group, picked from a dropdown in the settings tab.

- **Filter fields** gain "Status group" (a category filter, like Status, Assignee and Tag).
- **Built-in presets** gain "Completed" = `group is completed` and "Incomplete" = `group is not (completed, cancelled)`.
- The decision rests on the group alone: id and label strings (`done` and so on) are never looked at at runtime.

**Why:** "Done" goes by different names for different users (`done` / `Closed` / `Released`), so an implementation that guesses from names is bound to get it wrong sooner or later. Adding an `isDone` boolean to Status instead would squash "Cancelled" and "On hold" into the same *not done*, and no "Incomplete = work still left" list could be built. Wrike's four classes split "the work is moving / finished / stopped / gone" with nothing missing and nothing extra, and with these four, what notifications and dashboards show can be decided on the same basis too.

**Why not user-defined:** If groups could be added, "what counts as done" would become ambiguous again, and the presets' meaning would drift from user to user. The freedom to classify is already provided by Status (any number can be added), so the layer above it can stay fixed.

## Migration

Data saved before 2.9.0 has no `group`. On load it is guessed by **a partial match on the id and label** (evaluated in the order `completed` → `cancelled` → `deferred`; `active` when none matches), and the saved value is used from then on. The guess happens only once, and a wrong guess is fixed with one click in the settings tab, so there is no notice at startup; the release notes and the README announce it instead. The default statuses get `todo` / `in-progress` → `active`, `blocked` → `deferred` (work has stopped) and `done` → `completed`.

## Decisions

- **"Incomplete" leaves Cancelled out.** Taken literally it would be "everything but completed", but a dropped task isn't work still left to do, and a list with those mixed in is of no use.
- **What can't be classified isn't counted as completed.** A task with no status, or with an id that isn't in the settings, has "no group": it is left out of the Completed filter and included in the Incomplete one. Treating what is unknown as completed would make the Completed filter lie.
- **An empty Completed group isn't forbidden.** All it does is leave the Completed preset empty, so the settings tab only shows a warning (Wrike makes it mandatory, but that would complicate the delete UI for no real gain).
- **The Japanese labels don't follow Wrike's Japanese terms.** Wrike's Japanese UI calls the groups *yūkō / kanryō / enki / torikeshi-zumi*, but *yūkō* ("enabled") is easily misread as the ON/OFF of a settings screen, so the labels are **akutibu / kanryō / enki / kyanseru** ("active" and "cancel" as loanwords).

## Considered options

- **Adding `isDone: boolean` to Status**: the smallest change, but Cancelled and On hold can't be told apart, so an "Incomplete" list is of no practical use.
- **User-defined groups as well**: flexible, but what "done" means would drift from user to user, and presets couldn't share one meaning.
- **Writing the group in frontmatter**: Task files would gain information duplicating Status, and when the two disagreed there would be no telling which is right. The group is looked up from the Status definitions in settings each time.

## Notes

Grouping by status group (`groupBy`), and how notifications and the progress line treat completed tasks, are not part of this ADR: both are easily reversible UI specs that can be added just by calling `statusGroupOf()`.
