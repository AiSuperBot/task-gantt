# Obsidian Gantt

A plugin that brings a task-management UI like a project-management tool's to Obsidian. One file = one task, and a folder's contents are shown and edited as a "table + timeline" Gantt.

## Language

**Task**:
One Markdown file. Its frontmatter is the source of truth for the schedule (start, end, status, assignee, predecessor tasks), and its body (Body) is the task description. On the Gantt it is one bar (or a diamond = milestone) and one table row.
_Avoid_: Event, Item, Issue, Note

**Board**:
The whole table + timeline Gantt screen, gathering everything under the configured parent folder. A dedicated view opened from the ribbon icon.
_Avoid_: Plan, Chart, Timeline, View

**Group**:
A subfolder directly under the parent folder. In the table and the timeline it gathers the Tasks inside it under a "group heading row".
_Avoid_: Section, Folder, Category, List

**Body**:
The body of a Task (file): the Markdown content without the frontmatter. Shown in the detail panel.
_Avoid_: Description, Content, Note

**Dependency**:
A predecessor / successor relationship between Tasks. Written as the frontmatter `after` (an array of wikilinks to predecessor Tasks) and drawn as arrows on the timeline. When a predecessor's dates change, SS/FF successors line up with the predecessor, and FS successors are pushed later only when they overlap it (this can be turned off in settings; successors are never pulled back). Either way they keep their Duration. A separate concept from Subtask (parent/child).
_Avoid_: Link, Relation, Blocker, Predecessor

**Duration**:
The length of a Task: the number of **workdays** from its start date to its due date (both ends included; the weekdays set as non-working days are not counted). Not kept in frontmatter; worked out from `start` / `end` each time (the dates are the source of truth). Changing the duration keeps the start date and moves the due date; changing only the start date keeps the duration and moves the due date along with it (as Wrike does). Milestones have no duration.
_Avoid_: Length, Span, Estimate

**Workday**:
A working day: any day other than the weekdays in the "Non-working days" setting (Friday and Saturday by default, a Sunday-to-Thursday week). Duration and the moving of successors through a Dependency are all counted in workdays. Public holidays (specific dates) are not handled yet.
_Avoid_: Business day, Working day

**Subtask**:
A Task that has a parent Task. Written as the frontmatter `parent` (a single wikilink to the parent Task); in the table it is nested directly under its parent Task (sub-subtasks too, to any depth). A child lives in the same Group (folder) as its parent, and dragging and dropping it onto a parent moves it into the parent's folder. A hierarchy axis separate from Dependency (predecessor/successor) and Group (folder).
_Avoid_: Child, Sub-item, Nested task

**Rollup**:
A display that gathers the dates of everything under a parent Task (its descendant Tasks) into one summary bar. Switched by a board-wide toggle (OFF by default), and it applies to parent Tasks' bars only. While it is OFF, a parent Task is drawn with its own dates. The summary bars of Group (folder) rows always roll up and are not affected by this toggle.
_Avoid_: Summary, Aggregate, Parent bar

**Assignee**:
The person responsible for a Task. **Multi-valued**: the frontmatter `assignee` may be a single value or a list (with one person it is written as a single value). A Task with two or more assignees is a **shared task**; grouped by assignee, it appears in each assignee's group (the same additive multiple membership as Tag; a drag and drop onto an assignee group adds that assignee).
_Avoid_: Owner, Member, Person

**Task kind**:
The kind of content a Task holds, one of three: **Note** (the default), **Kanban** (a body in the Kanban plugin's format; frontmatter `kanban-plugin: board`) and **Canvas** (the content is the `.canvas` that the frontmatter `canvas` links to). Whatever its kind, a Task is one note, and that note's frontmatter is the source of truth for the schedule (the `.canvas` itself never becomes a Task).
_Avoid_: Type, Format, Template

**Status**:
The progress state of a Task (e.g. To do / In progress / Done). Defined in settings and reflected in the bar color.
_Avoid_: State, Phase

**Status group**:
The four classes a Status belongs to (Active / Completed / Deferred / Cancelled). **A fixed set of four**, modelled on Wrike, that users can't add to; every Status belongs to exactly one. Whether a task is completed or not is decided by this group alone, never guessed from a Status's id or label. Not kept in frontmatter; looked up from the Status definitions in settings each time.
_Avoid_: Category, Bucket, Phase

**Inline edit**:
Editing a value in place by double-clicking a table cell. **Every column the table can show supports Inline edit** (a new column ships with both its display rendering and its editor). Enter or losing focus saves, Esc cancels, and nothing is written when the value hasn't changed. A single click on an editable cell only selects the row (it doesn't open the detail panel), so the detail panel is opened by clicking the task name cell or the Bar, or by pressing Enter on the row. The task name cell alone can be renamed in place, by double-clicking it while the detail panel is open on that task (while the panel is closed, the first click only opens the panel). Columns are implemented as column definitions in `src/columns.ts`, whose types require a renderer and an editor for every column except name.
_Avoid_: Quick edit, Cell edit, Direct edit

**Custom field**:
Any frontmatter key the user declares in settings (`key` / display label / type text, number or date). It can be shown and sorted as a table column. It runs on the same "column definition" mechanism as the built-in columns (Start, Due, Assignee, Status).
_Avoid_: Property, Attribute, Metadata

**Tag**:
Obsidian's native tags (frontmatter `tags:` + body `#tag`). Multi-valued; used by filters, grouping and the Tags column. Where a Group (folder) is exclusive, one place only, tags are **additive multiple membership** (a drag and drop onto a tag group adds the tag; when grouped, a task appears in several groups). Reading includes body `#tag`s, but tags are added and removed in the frontmatter `tags:`.
_Avoid_: Label, Category, Keyword
