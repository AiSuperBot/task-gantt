---
status: superseded by ADR-0004
---

# DSL code block as the single source of truth

All of the Gantt's schedule information (start, end, assignee, status, dependencies) is held by a ` ```gantt ` code block in a note (the Plan), as its single source of truth. obsidian-pm's "one task = one Markdown note" approach is not adopted.

**Why:** With one note per task, more tasks mean an explosion of files and performance that has to be managed, which works against overseeing and bulk-editing the Gantt on one screen. Gathering the Plan into one block gives editing, diffs and write-backs a single, unambiguous target.

**Trade-off:** Linked notes (Detail notes) are detail pages only and hold no schedule information (one way: DSL → note). The obsidian-pm-style integration, where tasks link both ways with other notes automatically, is given up.
