// ボード（ステータスの列）とチーム（人ごと）の振り分けの検証 / Tests for the board's columns and the team's people
import { boardColumns, boardWhen, byPerson, isSprint } from "./lanes.mjs";

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

const task = (o) => ({ path: `${o.name}.md`, groups: [], deps: [], milestone: false, tags: [], assignees: [], ...o });
const STATUSES = [
  { id: "todo", label: "To do", color: "#888", group: "active" },
  { id: "doing", label: "In progress", color: "#00f", group: "active" },
  { id: "done", label: "Done", color: "#0a0", group: "completed" },
];
const names = (cells) => cells.map((c) => c.map((t) => t.name).join("+")).join("|");

// ── 列 / columns ──
const A = task({ name: "A", status: "todo", assignees: ["Dana"] });
const B = task({ name: "B", status: "doing", assignees: ["Eli"] });
const C = task({ name: "C", status: "review", assignees: ["[[Noa]]"] }); // ほかの端末で足したステータス / a status added on another computer
const D = task({ name: "D", status: "done", assignees: ["Dana"] });
const E = task({ name: "E" }); // ステータスなし / no status
check("columns follow the settings' status order", boardColumns([A, B, D], STATUSES).join() === "todo,doing,done");
check("a status the settings lack gets its own column, after them", boardColumns([A, C], STATUSES).join() === "todo,doing,done,review");
check("(none) comes first, only when a card has no status", boardColumns([A, E], STATUSES)[0] === null && boardColumns([A, C], STATUSES)[0] !== null);

// ── 人ごと / people ──
const people = (list) => list.map(([p, ts]) => `${p}:${ts.map((t) => t.name).join("+")}`).join(" | ");
check("one entry per person, by name; a link and a name are one person", people(byPerson([A, B, C, D], [], "Unassigned")) === "Dana:A+D | Eli:B | Noa:C");
check("me first, Unassigned last, idle people included", people(byPerson([A, E, D], ["Eli"], "Unassigned", "Eli")) === "Eli: | Dana:A+D | Unassigned:E");
check("a shared task shows under each of its people once", people(byPerson([task({ name: "S", assignees: ["Dana", "[[Dana]]", "Eli"] })], [], "Unassigned")) === "Dana:S | Eli:S");

// ── ボードでの時期（ノートの日付だけで）/ when a card sits on the board (from the note's dates only) ──
const TODAY = 20000;
const day = (n) => new Date((TODAY + n) * 86_400_000).toISOString().slice(0, 10);
check("work done and due within two weeks is now", boardWhen(task({ name: "x", end: day(-3) }), true, TODAY - 14, TODAY + 14) === "now");
check("work done and due earlier is older", boardWhen(task({ name: "x", end: day(-20) }), true, TODAY - 14, TODAY + 14) === "older");
check("undated finished work is older", boardWhen(task({ name: "x" }), true, TODAY - 14, TODAY + 14) === "older");
check("during a sprint, Done holds what was finished since it began", boardWhen(task({ name: "x", completed: day(-3) }), true, TODAY - 2, TODAY + 8) === "older" && boardWhen(task({ name: "x", completed: day(-2) }), true, TODAY - 2, TODAY + 8) === "now");
check("during a sprint, To do folds what starts after it ends", boardWhen(task({ name: "x", start: day(9) }), false, TODAY - 2, TODAY + 8) === "later" && boardWhen(task({ name: "x", start: day(8) }), false, TODAY - 2, TODAY + 8) === "now");
check("work finished recently counts by its completion day, not its old due date", boardWhen(task({ name: "x", end: day(-30), completed: day(-1) }), true, TODAY - 14, TODAY + 14) === "now");
check("open work starting within two weeks is now", boardWhen(task({ name: "x", start: day(10), end: day(12) }), false, TODAY - 14, TODAY + 14) === "now");
check("open work starting later is later", boardWhen(task({ name: "x", start: day(30), end: day(40) }), false, TODAY - 14, TODAY + 14) === "later");
check("open undated or overdue work is now", boardWhen(task({ name: "x" }), false, TODAY - 14, TODAY + 14) === "now" && boardWhen(task({ name: "x", start: day(-40), end: day(-30) }), false, TODAY - 14, TODAY + 14) === "now");

// ── スプリントのノート / sprint notes ──
check("#sprint and #sprint/12 are sprint notes, in any case", isSprint(task({ name: "S", tags: ["sprint"] })) && isSprint(task({ name: "S", tags: ["Sprint/12"] })));
check("#sprints and #sprint-planning are not", !isSprint(task({ name: "S", tags: ["sprints"] })) && !isSprint(task({ name: "S", tags: ["sprint-planning"] })));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
