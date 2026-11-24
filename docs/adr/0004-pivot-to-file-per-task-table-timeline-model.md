---
status: accepted
---

# Pivot to a file-per-task, table-plus-timeline model

ADR-0001 to ADR-0003 are retired, and the plugin pivots to a model that recreates a project-management-tool-style task UI in Obsidian.

**What:**
- **One file = one task**. Each note's **frontmatter** is the source of truth for the schedule (start, end, status, assignee, predecessor tasks). The note's **body (Body)** is the task description.
- **The subfolders directly under the configured parent folder = groups**, and the `.md` files inside them = tasks.
- The ribbon icon opens a dedicated Gantt view. The layout is `[folder/nav | task table (center) | timeline (right)]` (table + timeline). The table and the timeline **line up row for row**.
- Rendering is a **home-made table + SVG timeline** (frappe-gantt was dropped because it can't have a table on its left).
- Clicking a task slides in a **detail panel** from the right (dates, status, assignee, Body).
- Dragging a bar writes the `start`/`end` frontmatter back to its file. Dependencies are drawn as arrows and a violation only warns (no automatic scheduling).

**Why:** Running the DSL approach for real showed that the user's actual requirement was "a task-management UI like a project-management tool's, in Obsidian". Making each task a note of its own integrates it as it is with Obsidian's links, search and body editing, and leads straight to the table + timeline experience.

**Superseded:** ADR-0001 (the DSL as the source of truth), ADR-0002 (YAML DSL), ADR-0003 (frappe-gantt).
