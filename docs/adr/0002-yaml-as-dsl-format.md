---
status: superseded by ADR-0004
---

# YAML as the DSL format

The Plan's content is YAML (a `tasks:` array) inside the ` ```gantt ` block. A markwhen-style natural-language DSL (e.g. `2026-06-01/2026-06-10 Design @alice`) is not adopted.

**Why:** Two-way editing, where dragging or resizing a Gantt bar writes the dates back into the YAML, is a requirement. A standard YAML library reads and writes the structured array, so the round trip is robust. A home-made natural-language parser and serializer would have to guarantee by itself that a write-back never breaks the formatting or the cursor position, which is fragile.

**Trade-off:** It is less light to write by hand and less pleasant to look at than a markwhen-style DSL, and somewhat verbose.

**Note:** js-yaml loses comments, key order and formatting when it re-serializes. Write-backs must use a comment-preserving YAML (an AST, such as eemeli/`yaml`) or pinpoint text edits, so the user's hand-written formatting is never broken.
