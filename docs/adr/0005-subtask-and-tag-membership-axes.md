---
status: accepted
---

# New membership axes for Tasks: subtasks and tags

Until now a Task's only structural axis was the **Folder (Group)**, and its only relational axis the **Dependency (`after`)**. This adds **two axes**.

- **Subtask**: a parent/child relation written as the frontmatter `parent` (a **single wikilink** to the parent Task). A child **lives in its parent's folder**, and drag and drop **moves** it (a drop on a task row = setting the parent + moving into the parent's folder; a drop on a folder row = removing the parent). A parent moves with its whole subtree (one Undo restores it), and when the parent is missing, the child is promoted to directly under the folder. It has no scheduling effect (it only groups the display; dependencies stay a separate axis, as before).
- **Tag**: Obsidian's native `tags` (**multi-valued**). Where a folder is exclusive (one place only), tags are **additive multiple membership**. A drag and drop onto a tag group **adds the tag**, and when grouped, a task is **shown in several groups** (like a "virtual folder").

**Why:** To get a PM tool's hierarchy and classification while keeping "one file = one task" (ADR-0004). A file can't contain files, so the hierarchy is a logical link (`parent`), and classification uses native tags so that it integrates with Obsidian's search and tag pane. The **asymmetry of drag and drop**, folder = move (exclusive) and tag = add (multiple), keeps the two roles clearly apart.

## Considered options

- **Subtask = a purely logical link (anywhere; option Z)**: rejected, because a child's physical folder and its display position would disagree, contradicting the folder axis. Instead, "bringing it to a parent = moving it into the parent's folder" keeps the display tree unambiguous.
- **Parent bar = always rolled up automatically (MS Project style)**: to avoid the confusion of ignoring a parent's own dates or making them read-only, the default is "its own dates". Rolling up is optional, through the board-wide rollup toggle (OFF by default).
- **Tag = a field of our own**: rejected, since it would be managed twice alongside Obsidian's tag feature.

## Notes

Sorting (column headers ↑↓), showing and hiding columns (the gear), custom fields (key/label/type declared in settings) and the flat view are easily reversible UI specs, so they are not part of this ADR and are kept in CONTEXT.md and the design summary.
