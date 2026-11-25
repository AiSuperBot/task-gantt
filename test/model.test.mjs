// Tests for buildRows, milestone detection, and group span rollup
import { bodyOf, withBody, movePaths, buildRows, kanbanLanes, listWith, newStatus, cardProgress, kanbanStep, anchorStart, anchorEnd, subtreePaths, parseStored, combineDateTime, toInstant, inferStatusGroup, statusGroupOf, customFieldIssues, validCustomFields, readCustomValue, customValueText, parseCustomInput, setCardDone, withoutName, applyStatus, cardDoneOn, cardLabel, seeSteps } from "./model.mjs";

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) {
    pass++;
    console.log("  ok  -", name);
  } else {
    fail++;
    console.error("FAIL  -", name);
  }
}

// kanban progress: 100% only when all are done, 0% only when none are
check("cardProgress 199/200 is 99", cardProgress(199, 200) === 99);
check("cardProgress all done is 100", cardProgress(200, 200) === 100);
check("cardProgress 1/201 is 1", cardProgress(1, 201) === 1);
check("cardProgress 0 cards is 0", cardProgress(0, 5) === 0);
// a small stand-in for Obsidian's metadata (headings, list items, thematic breaks)
function fakeCache(text) {
  const cache = { headings: [], listItems: [], sections: [] };
  let offset = 0;
  text.split("\n").forEach((line, i) => {
    const position = { start: { line: i, col: 0, offset }, end: { line: i, col: line.length, offset: offset + line.length } };
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    const li = line.match(/^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[(.)\]\s+)?/);
    if (h) cache.headings.push({ level: h[1].length, heading: h[2], position });
    else if (line.trim() === "***") cache.sections.push({ type: "thematicBreak", position });
    else if (li) cache.listItems.push({ parent: li[1] ? i - 1 : -i, task: li[2], position });
    offset += line.length + 1;
  });
  return [cache, text];
}
const lanesOf = (text) => kanbanLanes(...fakeCache(text)).map((l) => `${l.title}:${l.cards.map((c) => `${c.text}${c.done ? "✓" : ""}`).join("+")}`).join(" | ");

// any bullet in a lane is a card, checkbox or not
check("kanbanLanes: every bullet is a card", lanesOf(["## Todo", "- idea", "+ [x] done", "1. [ ] numbered", "## Done", "- [x] shipped"].join("\n")) === "Todo:idea+done✓+numbered | Done:shipped✓");
// the archive (## Archive after ***) is neither a lane nor counted
const archived = ["## Doing", "- [ ] a", "- [ ] b", "## Done", "- [x] c", "", "***", "", "## Archive", "", "- [x] old 1", "- [x] old 2"].join("\n");
check("kanbanLanes: the archive isn't counted", lanesOf(archived) === "Doing:a+b | Done:c✓");
check("kanbanLanes: the same count without the text", kanbanLanes(fakeCache(archived)[0]).flatMap((l) => l.cards).length === 3);

// ticking a card from the panel: that line only, and only while it's the same card
const board = ["## Doing", "- [ ] a [[x|y]]", "- b", "## Done", "- [x] c\r"].join("\n");
const cardLine = (text) => kanbanLanes(...fakeCache(text)).flatMap((l) => l.cards).find((c) => c.text === "a [[x|y]]").line;
check("setCardDone: ticks the box", setCardDone(board, cardLine(board), "a [[x|y]]", true) === board.replace("- [ ] a", "- [x] a"));
check("setCardDone: a card without a checkbox gets one", setCardDone(board, 2, "b", true) === board.replace("- b", "- [x] b"));
check("setCardDone: unticks a CRLF line too", setCardDone(board, 4, "c", false) === board.replace("- [x] c", "- [ ] c"));
check("withoutName: drops the name and the separator", withoutName("DB Adapter — כתיבת מתאם", "DB Adapter") === "כתיבת מתאם");
check("withoutName: no separator, no change", withoutName("DB Adaptery x", "DB Adapter") === "DB Adaptery x");
check("withoutName: a card that is only the name stays", withoutName("DB Adapter", "DB Adapter") === "DB Adapter");
check("setCardDone: writes nothing when the line holds another card", setCardDone(board, 2, "a [[x|y]]", true) === null);
// a tick adds nothing to the card; an untick removes an earlier "✅ date"
check("setCardDone: a tick adds no text", setCardDone(board, 2, "b", true) === board.replace("- b", "- [x] b"));
const dated = board.replace("- [x] c\r", "- [x] c ✅ 2026-11-15 ✅ 2026-11-16\r");
check("setCardDone: an untick removes every ✅ date, keeping CRLF", setCardDone(dated, 4, "c ✅ 2026-11-15 ✅ 2026-11-16", false) === board.replace("- [x] c\r", "- [ ] c\r"));
check("setCardDone: a tick keeps a ✅ date already there", setCardDone(dated, 4, "c ✅ 2026-11-15 ✅ 2026-11-16", true) === dated);
// the day this computer first saw a step ticked
const C = (text, done) => ({ text, done });
const base = seeSteps(undefined, [C("a", true), C("b", false)], "2026-11-18", "2026-10-19");
check("seeSteps: a board seen for the first time dates nothing", base.done.join() === "a" && Object.keys(base.on).length === 0);
const next = seeSteps(base, [C("a", true), C("[[Pool|b]]", true), C("c", false)], "2026-11-19", "2026-10-20");
check("seeSteps: a newly ticked step gets today, by its label", next.on.b === "2026-11-19" && next.on.a === undefined);
check("seeSteps: unticking drops the date", seeSteps(next, [C("b", false)], "2026-11-20", "2026-10-21").on.b === undefined);
check("seeSteps: an archived step keeps its date", seeSteps(next, [C("a", true)], "2026-11-20", "2026-10-21").on.b === "2026-11-19");
check("seeSteps: old dates are let go", seeSteps(next, [C("a", true), C("b", true)], "2026-12-25", "2026-11-25").on.b === undefined);
check("seeSteps: a step already dated keeps its first day", seeSteps(next, [C("a", true), C("b", true)], "2026-11-21", "2026-10-22").on.b === "2026-11-19");
check("cardDoneOn: reads the ✅ date", cardDoneOn("Connection pool ✅ 2026-11-14") === "2026-11-14" && cardDoneOn("Connection pool") === undefined);
check("cardLabel: hides the ✅ date", cardLabel("[[Connection pool|מאגר חיבורים]] ✅ 2026-11-14") === "מאגר חיבורים");

// the status and its completion day (the day it entered the Completed group)
const ST = [{ id: "todo", label: "To do", color: "#888", group: "active" }, { id: "done", label: "Done", color: "#0a0", group: "completed" }, { id: "shipped", label: "Shipped", color: "#0b0", group: "completed" }, { id: "blocked", label: "Blocked", color: "#e44", group: "deferred" }, { id: "waiting", label: "Waiting", color: "#e84", group: "deferred" }];
const KEYS = { status: "status", completed: "completed", blocker: "blocker" };
const fmAfter = (fm, id, today) => (applyStatus(fm, KEYS, ST, id, today), JSON.stringify(fm));
check("applyStatus: entering the Completed group writes the day", fmAfter({ status: "todo" }, "done", "2026-11-15") === '{"status":"done","completed":"2026-11-15"}');
check("applyStatus: moving between completed statuses keeps the date", fmAfter({ status: "done", completed: "2026-11-10" }, "shipped", "2026-11-15") === '{"status":"shipped","completed":"2026-11-10"}');
check("applyStatus: leaving the Completed group clears the date", fmAfter({ status: "done", completed: "2026-11-10" }, "todo", "2026-11-15") === '{"status":"todo"}');
check("applyStatus: clearing the status clears the date too", fmAfter({ status: "done", completed: "2026-11-10" }, undefined, "2026-11-15") === "{}");
check("applyStatus: a completed status without a date gets one", fmAfter({ status: "done" }, "done", "2026-11-15") === '{"status":"done","completed":"2026-11-15"}');
check("applyStatus: the blocker reason stays while the task stays in the Deferred group", fmAfter({ status: "blocked", blocker: "security review" }, "waiting", "2026-11-15") === '{"status":"waiting","blocker":"security review"}');
check("applyStatus: leaving the Deferred group clears the blocker reason", fmAfter({ status: "blocked", blocker: "security review" }, "todo", "2026-11-15") === '{"status":"todo"}');
check("applyStatus: a reason on a note that wasn't deferred is left alone by other status changes", fmAfter({ status: "todo", blocker: "[[Legal sign-off]]" }, "doing", "2026-11-15") === '{"status":"doing","blocker":"[[Legal sign-off]]"}' && fmAfter({ blocker: "x" }, "todo", "2026-11-15") === '{"blocker":"x","status":"todo"}');

// adding or removing one entry of a multi-valued field
check("listWith: adding to a single person makes a list", JSON.stringify(listWith("Ana", "Ben", true)) === '["Ana","Ben"]');
check("listWith: the same person (same display name) isn't added", listWith(["[[Ben]]"], "Ben", true) === undefined);
check("listWith: an unquoted [[x]] is kept, as text", JSON.stringify(listWith([["Ana"]], "Ben", true)) === '["[[Ana]]","Ben"]');
check("listWith: removing one keeps the other values as written", JSON.stringify(listWith(["Ana", 7, "Ben"], "Ben", false)) === '["Ana",7]');
check("listWith: a list stays a list", JSON.stringify(listWith(["Ana", "Ben"], "Ben", false)) === '["Ana"]');
check("listWith: removing the last person gives null (the key goes)", listWith("Ana", "Ana", false) === null);
check("listWith: removing someone who isn't there changes nothing", listWith("Ana", "Ben", false) === undefined);


// a new status: id from the label (numbered), an unused palette colour
const st0 = [{ id: "todo", label: "To do", color: "#ef4444", group: "active" }];
const st1 = newStatus(st0, "In review");
check("newStatus: the id comes from the label", st1.id === "in-review" && st1.label === "In review" && st1.group === "active");
check("newStatus: an unused colour", st1.color !== "#ef4444");
check("newStatus: the same label gets numbered", newStatus([...st0, st1], "In review").id === "in-review-2");

// milestone collapses to its due date
const ms = { milestone: true, end: "2026-02-10" };
check("anchorStart(milestone)=end", anchorStart(ms) === "2026-02-10");
check("anchorEnd(milestone)=end", anchorEnd(ms) === "2026-02-10");

// time parsing, timezone conversion, combining
const eq = (p, date, time) => p != null && p.date === date && p.time === time;
check("parseStored(date only)", eq(parseStored("2026-06-12", "+09:00"), "2026-06-12", undefined));
check("parseStored(naive stays as is)", eq(parseStored("2026-06-12T09:30", "+00:00"), "2026-06-12", "09:30"));
check("parseStored(one-digit hour)=07:00", eq(parseStored("2026-06-12T7:00", "+09:00"), "2026-06-12", "07:00"));
check("parseStored(invalid time)=date only", eq(parseStored("2026-06-12T25:00", "+09:00"), "2026-06-12", undefined));
check("parseStored(invalid value)=undefined", parseStored("TBD", "+09:00") === undefined);
check("parseStored(null)=undefined", parseStored(null, "+09:00") === undefined);
check("parseStored(same TZ)", eq(parseStored("2026-06-12T09:00+09:00", "+09:00"), "2026-06-12", "09:00"));
check("parseStored(+09:00→GMT)", eq(parseStored("2026-06-12T09:00+09:00", "+00:00"), "2026-06-12", "00:00"));
check("parseStored(Z→+09:00)", eq(parseStored("2026-06-12T09:00Z", "+09:00"), "2026-06-12", "18:00"));
check("parseStored(crosses into another day)", eq(parseStored("2026-06-12T01:00+09:00", "-05:00"), "2026-06-11", "11:00"));
check("parseStored(half-hour TZ)", eq(parseStored("2026-06-12T09:00+09:00", "+05:30"), "2026-06-12", "05:30"));
check("combineDateTime(adds the offset)", combineDateTime("2026-06-12", "09:30", "+09:00") === "2026-06-12T09:30+09:00");
check("combineDateTime(negative offset)", combineDateTime("2026-06-12", "09:30", "-05:00") === "2026-06-12T09:30-05:00");
check("combineDateTime(date only)", combineDateTime("2026-06-12", "", "+09:00") === "2026-06-12");
check("combineDateTime(no date)=undefined", combineDateTime(undefined, "09:30", "+09:00") === undefined);
// round-trip: write then read back yields the same display
check("round-trip(write→read)", eq(parseStored(combineDateTime("2026-06-12", "09:30", "+09:00"), "+09:00"), "2026-06-12", "09:30"));

// wall clock → absolute instant (for notification triggers)
check("toInstant(+09:00)", toInstant("2026-06-12", "09:00", "+09:00") === Date.UTC(2026, 5, 12, 0, 0));
check("toInstant(GMT)", toInstant("2026-06-12", "09:00", "+00:00") === Date.UTC(2026, 5, 12, 9, 0));
check("toInstant(-05:00)", toInstant("2026-06-12", "09:00", "-05:00") === Date.UTC(2026, 5, 12, 14, 0));

// multi-level nesting
const tasks = [
  { path: "p/Cleaning/Floor/Sweeping.md", name: "Sweeping", groups: ["Cleaning", "Floor"], start: "2026-02-01", end: "2026-02-03", after: [], milestone: false },
  { path: "p/Cleaning/Floor/Mopping.md", name: "Mopping", groups: ["Cleaning", "Floor"], start: "2026-02-04", end: "2026-02-07", after: [], milestone: false },
  { path: "p/Cleaning/Bath/Drain.md", name: "Drain", groups: ["Cleaning", "Bath"], start: "2026-02-08", end: "2026-02-10", after: [], milestone: false },
  { path: "p/Cleaning/Bath/Report.md", name: "Report", groups: ["Cleaning", "Bath"], end: "2026-02-10", after: [], milestone: true },
];

const rows = buildRows(tasks);
const groupRows = rows.filter((r) => r.kind === "group");
const taskRows = rows.filter((r) => r.kind === "task");
check("three group rows (Cleaning/Floor/Bath)", groupRows.length === 3);
check("four task rows", taskRows.length === 4);

const top = rows[0];
check("Cleaning comes first (depth 0)", top.kind === "group" && top.group === "Cleaning" && top.depth === 0);
check("Cleaning span = 2/1..2/10", top.span?.start === "2026-02-01" && top.span?.end === "2026-02-10");

const floor = groupRows.find((r) => r.group === "Floor");
check("Floor is depth 1", floor.depth === 1);
check("Floor span = 2/1..2/7", floor.span?.start === "2026-02-01" && floor.span?.end === "2026-02-07");

const bath = groupRows.find((r) => r.group === "Bath");
check("Bath span = 2/8..2/10", bath.span?.start === "2026-02-08" && bath.span?.end === "2026-02-10");

// its tasks at depth 2
const floorIdx = rows.indexOf(floor);
check("the row after Floor is a task (depth 2)", rows[floorIdx + 1].kind === "task" && rows[floorIdx + 1].depth === 2);

// collapse hides children
const collapsedRows = buildRows(tasks, new Set(["Cleaning"]));
check("collapsing Cleaning leaves one row (Cleaning itself)", collapsedRows.length === 1 && collapsedRows[0].group === "Cleaning");

// collapse only Floor
const c2 = buildRows(tasks, new Set(["Cleaning/Floor"]));
check("collapsing Floor hides Sweeping/Mopping", !c2.some((r) => r.task?.name === "Sweeping"));
check("collapsing Floor keeps the Bath tasks", c2.some((r) => r.task?.name === "Drain"));

// a folder's own tasks come before its subfolders (after them they'd read as part of the subfolder above)
const mixed = buildRows([
  { path: "p/Root task.md", name: "Root task", groups: [], start: "2026-02-01", end: "2026-02-01", milestone: false },
  { path: "p/A/In A.md", name: "In A", groups: ["A"], start: "2026-02-02", end: "2026-02-02", milestone: false },
]);
check("tasks at the root come before the folders", mixed[0].kind === "task" && mixed[0].task.name === "Root task" && mixed[1].group === "A");

// ----- kanban bodies -----
check("kanban: lanes, cards and done", lanesOf(["## To do", "", "- [ ] Header", "- [ ] Footer", "  - [x] nested, not a card", "", "## Done", "", "**Complete**", "- [x] Setup"].join("\n")) === "To do:Header+Footer | Done:Setup✓");
check("kanban: a list before the first lane is ignored", lanesOf("- [ ] stray\n## L\n- card") === "L:card");

// a kanban's current and next card
const KS = [{ id: "todo", label: "To do", group: "active" }, { id: "in-progress", label: "In progress", group: "active" }, { id: "blocked", label: "Blocked", group: "deferred" }, { id: "done", label: "Done", group: "completed" }];
const lane = (title, ...cards) => ({ title, cards: cards.map((c) => ({ text: c.replace(/^x /, ""), done: c.startsWith("x ") })) });
check("kanban: now is the first unticked card in the started lane", JSON.stringify(kanbanStep([lane("To do", "a"), lane("In progress", "x b", "c"), lane("Done", "x d")], KS, "in-progress")) === '{"card":"c","stage":"In progress","now":true}');
check("kanban: with no current card, next skips the blocked and done lanes", JSON.stringify(kanbanStep([lane("Blocked", "z"), lane("To do", "x a", "b"), lane("In progress", "x c")], KS, "in-progress")) === '{"card":"b","stage":"To do"}');
check("kanban: step lanes (not statuses) are read in order, formatting stripped", JSON.stringify(kanbanStep([lane("שלב 1", "x א"), lane("שלב 2", "[[DB|חיבור]] @{2026-11-10}")], KS, "in-progress")) === '{"card":"חיבור","stage":"שלב 2"}');
check("kanban: nothing when every card is done", JSON.stringify(kanbanStep([lane("To do", "x a")], KS, "in-progress")) === "{}");

// ----- subtask nesting -----
const sub = [
  { path: "p/F/Parent.md", name: "Parent", groups: ["F"], start: "2026-03-01", end: "2026-03-02", after: [], milestone: false },
  { path: "p/F/Child.md", name: "Child", groups: ["F"], start: "2026-03-05", end: "2026-03-08", after: [], milestone: false, parent: "p/F/Parent.md" },
];
// nest by parent
const nestRows = buildRows(sub, new Set(), [], undefined, true);
const pRow = nestRows.find((r) => r.task?.name === "Parent");
const cRow = nestRows.find((r) => r.task?.name === "Child");
check("the parent row hasChildren", pRow.hasChildren === true);
check("the child is one level deeper than the parent", cRow.depth === pRow.depth + 1);
check("the parent's rollup span = 3/1..3/8", pRow.span?.start === "2026-03-01" && pRow.span?.end === "2026-03-08");

// collapsing the parent hides the child
const nestCollapsed = buildRows(sub, new Set(["p/F/Parent.md"]), [], undefined, true);
check("collapsing the parent hides the child", !nestCollapsed.some((r) => r.task?.name === "Child"));
// a nested child is marked sub
check("only the nested child is sub", cRow.sub === true && !pRow.sub);

// without nesting, siblings stay flat
const flatRows = buildRows(sub);
check("without nesting, parent and child share a depth", flatRows.find((r) => r.task?.name === "Parent").depth === flatRows.find((r) => r.task?.name === "Child").depth);

// subtree includes self + descendants
check("subtreePaths is the parent + its child", JSON.stringify(subtreePaths(sub, "p/F/Parent.md").sort()) === JSON.stringify(["p/F/Child.md", "p/F/Parent.md"]));

// ── status groups ──
// the migration guess matches id or label
check("guess: done → completed", inferStatusGroup("done", "Done") === "completed");
check("guess: בוצע → completed", inferStatusGroup("butza", "בוצע") === "completed");
check("guess: cancelled → cancelled", inferStatusGroup("cancelled", "Cancelled") === "cancelled");
check("guess: בוטל → cancelled", inferStatusGroup("butal", "בוטל") === "cancelled");
check("guess: on hold → deferred", inferStatusGroup("on-hold", "On hold") === "deferred");
check("guess: blocked → deferred", inferStatusGroup("blocked", "Blocked") === "deferred");
check("guess: בהמתנה → deferred", inferStatusGroup("hamtana", "בהמתנה") === "deferred");
check("guess: in progress → active", inferStatusGroup("in-progress", "In progress") === "active");
check("guess: בביצוע (in progress) → active, not done", inferStatusGroup("bebitzua", "בביצוע") === "active");
check("guess: an unknown word → active", inferStatusGroup("review", "בבדיקה") === "active");
// completed wins on the first hit
check("guess: case is ignored", inferStatusGroup("DONE", "DONE") === "completed");

const statusDefs = [
  { id: "todo", label: "To do", color: "#000", group: "active" },
  { id: "done", label: "Done", color: "#000", group: "completed" },
];
check("statusGroupOf: a defined id", statusGroupOf(statusDefs, "done") === "completed");
check("statusGroupOf: no status is undefined", statusGroupOf(statusDefs, undefined) === undefined);
check("statusGroupOf: an empty string is undefined", statusGroupOf(statusDefs, "") === undefined);
// unknown ids stay unclassified
check("statusGroupOf: an unknown id is undefined", statusGroupOf(statusDefs, "ghost") === undefined);

// successorClosure moved to schedule.test.mjs

// ── Custom field ──
{
  const keys = { start: "start", end: "due", status: "status", assignee: "owner", after: "after", progress: "progress", milestone: "milestone", parent: "parent", gcalId: "gcalId", gcal: "gcal" };
  const cf = (id, key, type = "text") => ({ id, key, label: "", type });
  const settings = { keys, customFields: [cf("a", "client"), cf("b", " "), cf("c", "due"), cf("d", "tags"), cf("e", "client"), cf("f", "budget", "number")] };
  const issues = customFieldIssues(settings);
  check("cf: an empty key is empty", issues.get("b") === "empty");
  check("cf: a configured built-in key (the due date = due) is reserved", issues.get("c") === "reserved");
  check("cf: tags is reserved", issues.get("d") === "reserved");
  check("cf: the second use of a key is duplicate", issues.get("e") === "duplicate" && !issues.has("a"));
  check("cf: only the valid ones, in definition order", validCustomFields(settings).map((f) => f.id).join(",") === "a,f");

  check("cf read: text", readCustomValue("ACME", "text", "system") === "ACME");
  check("cf read: a number in a text field becomes a string", readCustomValue(42, "text", "system") === "42");
  check("cf read: a list in a text field stays an array", JSON.stringify(readCustomValue(["a", "", "b"], "text", "system")) === JSON.stringify(["a", "b"]));
  check("cf read: empty or null is undefined", readCustomValue("", "text", "system") === undefined && readCustomValue(null, "number", "system") === undefined);
  check("cf read: number", readCustomValue("12.5", "number", "system") === 12.5 && readCustomValue(3, "number", "system") === 3);
  check("cf read: a non-number is undefined", readCustomValue("abc", "number", "system") === undefined);
  check("cf read: a date keeps only the date part", readCustomValue("2024-05-06T10:30", "date", "system") === "2024-05-06");
  check("cf read: a non-date is undefined", readCustomValue("someday", "date", "system") === undefined);

  check("cf text: a list is comma-separated", customValueText(["a", "b"]) === "a, b" && customValueText(undefined) === "");
  check("cf input: empty deletes", parseCustomInput("  ", "text", false) === undefined);
  check("cf input: number", parseCustomInput(" 7 ", "number", false) === 7);
  check("cf input: a number that doesn't parse isn't written (null)", parseCustomInput("x", "number", false) === null);
  check("cf input: text that was a list goes back to a list", JSON.stringify(parseCustomInput("a, b ,", "text", true)) === JSON.stringify(["a", "b"]));
  check("cf input: text that was a single value stays as is", parseCustomInput("a, b", "text", false) === "a, b");
}

// splitting body and frontmatter (CRLF, an empty ---/---, none at all)
check("bodyOf: ordinary frontmatter", bodyOf("---\na: 1\n---\nhello\n") === "hello");
check("bodyOf: CRLF", bodyOf("---\r\na: 1\r\n---\r\nhello\r\n") === "hello");
check("bodyOf: an empty ---/--- stays out of the body", bodyOf("---\n---\nhello") === "hello" && bodyOf("---\n---") === "");
check("bodyOf: keeps the first line's indent (drops only blank lines)", bodyOf("---\na: 1\n---\n\n    code\n    more\n") === "    code\n    more");
check("bodyOf: no frontmatter", bodyOf("hello\n---\nx") === "hello\n---\nx");
check("withBody: adds no blank line right after the frontmatter", withBody("---\na: 1\n---\nold\n", "new") === "---\na: 1\n---\nnew\n");
check("withBody: CRLF frontmatter stays as is", withBody("---\r\na: 1\r\n---\r\nold", "new") === "---\r\na: 1\r\n---\r\nnew\n");
check("withBody: keeps an empty ---/---, and the body can be emptied", withBody("---\n---", "x") === "---\n---\nx\n" && withBody("---\na: 1\n---\nold", "") === "---\na: 1\n---\n");
check("withBody: no frontmatter", withBody("old", "new") === "new\n");

check("movePaths: follows file and folder renames", movePaths(["A/x.md", "A/sub/y.md", "B.md", "AB.md"], "A", "Z").join() === "Z/x.md,Z/sub/y.md,B.md,AB.md" && movePaths(["B.md"], "B.md", "C.md")[0] === "C.md");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
