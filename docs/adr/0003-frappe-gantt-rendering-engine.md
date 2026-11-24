---
status: superseded by ADR-0004
---

# frappe-gantt as the rendering engine

The Gantt's rendering (dragging and resizing bars, dependency arrows, day-to-month zoom) is built on frappe-gantt (MIT, vanilla SVG, framework-independent). Home-made SVG and DHTMLX/SVAR are not adopted.

**Why:** The "heavy but standard" parts, such as the drag math, routing the dependency arrows and zooming, come from a proven library. Callbacks such as `on_date_change` can be wired to the YAML write-back. Building it ourselves costs the most effort, and DHTMLX's commercial/GPL license and bundle bloat are a poor fit for distributing an Obsidian plugin.

**Trade-off:** Coloring by assignee or status and the finer UI details need reinforcing with custom CSS, and fine-grained behavior depends on the library's implementation. Parent/child rollups are not something it does well out of the box, so for now subtasks stay "group headings only" (consistent with the direction of [ADR-0001]).
