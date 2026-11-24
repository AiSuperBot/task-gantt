// Tests for the work plan export: which tasks, rows and lanes, right-to-left positions, months, colours, markers, and the .pptx itself
import JSZip from "jszip";
import { buildWorkPlan, categoryOf, fitText, monthSpans, planPeriods, textEm, MIN_PT } from "./workplan.mjs";
import { workPlanPptx } from "./workplan-pptx.mjs";
import { hashColor } from "./colors.mjs";

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

const day = (iso) => Date.parse(iso) / 86_400_000;
const near = (a, b) => Math.abs(a - b) < 1e-6;
const task = (o) => ({ path: `${o.name}.md`, groups: [], deps: [], milestone: false, tags: [], assignees: [], custom: {}, kind: "note", status: "doing", ...o });
const STATUSES = [
  { id: "todo", label: "To do", color: "#888", group: "active" },
  { id: "doing", label: "Doing", color: "#00f", group: "active" },
  { id: "hold", label: "On hold", color: "#f00", group: "deferred" },
  { id: "done", label: "Done", color: "#0a0", group: "completed" },
  { id: "drop", label: "Dropped", color: "#999", group: "cancelled" },
];
const settings = { statuses: STATUSES, tagColors: [{ name: "Dev", color: "#3b82f6" }], folderColors: [{ name: "Alpha", color: "#ff0000" }] };
const Q1 = { start: "2027-01-01", end: "2027-03-31", label: "רבעון 1 · 2027" }; // 90 days
const TODAY = day("2027-02-15");
const plan = (tasks, period = Q1) => buildWorkPlan({ tasks, settings, period, board: "צוות", today: TODAY });
const rowOf = (p, who) => p.pages.flatMap((pg) => pg.rows).filter((r) => r.label.text.replace("\n", " ") === who);
const barOf = (p, name) => p.pages.flatMap((pg) => pg.rows.flatMap((r) => r.bars)).find((b) => b.path === `${name}.md`);
// the timeline's edges and a day's width, read off the month headers
const edges = (p) => {
  const right = p.months[0].x + p.months[0].w + 0.02;
  const last = p.months[p.months.length - 1];
  return { right, left: last.x - 0.02 };
};

// ── periods ──
const periods = planPeriods(day("2026-11-24"));
check("periods: this and next quarter, this and next half", periods.map((x) => `${x.start}..${x.end} ${x.label}`).join(" | ") === "2026-10-01..2026-12-31 רבעון 4 · 2026 | 2027-01-01..2027-03-31 רבעון 1 · 2027 | 2026-07-01..2026-12-31 חציון 2 · 2026 | 2027-01-01..2027-06-30 חציון 1 · 2027");

// ── which tasks, which rows ──
const base = [
  task({ name: "A", start: "2027-01-01", end: "2027-01-10", assignees: ["Dana"] }),
  task({ name: "B", start: "2027-01-10", end: "2027-01-20", assignees: ["Dana"] }), // shares Jan 10 with A
  task({ name: "C", start: "2027-01-11", end: "2027-01-20", assignees: ["Dana"] }), // starts the day after A ends
  task({ name: "Shared", start: "2027-02-01", end: "2027-02-20", assignees: ["[[Eli]]", "Dana"] }),
  task({ name: "Nobody", start: "2027-03-01", end: "2027-03-05" }),
  task({ name: "Sprint", start: "2027-01-03", end: "2027-01-16", tags: ["sprint/12"], assignees: ["Dana"] }),
  task({ name: "Dropped", start: "2027-01-03", end: "2027-01-16", status: "drop", assignees: ["Dana"] }),
  task({ name: "Undated", assignees: ["Dana"] }),
  task({ name: "Later", start: "2027-05-01", end: "2027-05-10", assignees: ["Zed"] }),
];
const p1 = plan(base);
const rows = p1.pages[0].rows.map((r) => r.label.text);
check("one row per person by name, nobody's work last", rows.join("|") === "Dana|Eli|ללא אחראי");
check("a shared task shows in each of its people's rows", rowOf(p1, "Dana")[0].bars.some((b) => b.path === "Shared.md") && rowOf(p1, "Eli")[0].bars.some((b) => b.path === "Shared.md"));
check("unassigned work goes in the ללא אחראי row", rowOf(p1, "ללא אחראי")[0].bars.map((b) => b.path).join() === "Nobody.md");
const all = p1.pages.flatMap((pg) => pg.rows.flatMap((r) => r.bars.map((b) => b.path)));
check("sprint notes, cancelled, undated and out-of-period work are left out", !["Sprint.md", "Dropped.md", "Undated.md", "Later.md"].some((x) => all.includes(x)));

// ── lanes ──
const [A, B, C] = ["A", "B", "C"].map((n) => barOf(p1, n));
check("lanes: tasks sharing a day stack, the next day's fits beside", near(A.y, C.y) && B.y > A.y + A.h);
check("lanes: a row is as tall as its lanes", rowOf(p1, "Dana")[0].h > rowOf(p1, "Eli")[0].h * 1.5);

// ── right to left ──
const { right, left } = edges(p1);
const dayW = (right - left) / 90;
check("right to left: earlier work sits further right", A.x > C.x && C.x > barOf(p1, "Shared").x);
check("a box spans its days: from its start day's right edge to its end day's left edge (less a small gap)", near(A.x + A.w, right - 0.025) && near(A.x, right - 10 * dayW + 0.025));
check("today: a line in the middle of its day", near(p1.today, right - 45.5 * dayW));
check("today outside the period: no line", plan(base, { start: "2027-04-01", end: "2027-06-30", label: "" }).today === undefined);

// ── clipping ──
const p2 = plan([
  task({ name: "Before", start: "2026-12-15", end: "2027-01-20", assignees: ["Dana"] }),
  task({ name: "After", start: "2027-03-01", end: "2027-04-10", assignees: ["Dana"] }),
  task({ name: "Inside", start: "2027-02-01", end: "2027-02-10", assignees: ["Dana"] }),
]);
const [before, after, inside] = ["Before", "After", "Inside"].map((n) => barOf(p2, n));
check("clipped: work begun before the period runs into the right edge, marked", before.clipStart && !before.clipEnd && near(before.x + before.w, right));
check("clipped: work ending after the period runs into the left edge, marked", after.clipEnd && !after.clipStart && near(after.x, left));
check("not clipped: inside work is unmarked", !inside.clipStart && !inside.clipEnd);

// ── months ──
check("Gregorian months, in Hebrew", p1.months.map((m) => m.text).join() === "ינואר,פברואר,מרץ");
check("Hebrew months by their real dates (5787 is a leap year)", p1.hebMonths.map((m) => m.text).join() === "טבת,שבט,אדר א׳,אדר ב׳");
const heb = new Intl.DateTimeFormat("he-u-ca-hebrew", { month: "long", timeZone: "UTC" });
const spans = monthSpans(day("2027-01-01"), 90, (d) => heb.format(new Date(d * 86_400_000)));
check("1 Shevat 5787 is 9 January 2027", spans[1].name === "שבט" && spans[1].from === 8);
check("the Shevat header starts at 9 January", near(p1.hebMonths[1].x + p1.hebMonths[1].w + 0.02, right - 8 * dayW));
check("month gridlines at the Gregorian boundaries", p1.grid.length === 2 && near(p1.grid[0], right - 31 * dayW));

// ── categories ──
const t = (o) => task({ name: "x", ...o });
check("category: the first tag with a colour (any case), named as in the settings", JSON.stringify(categoryOf(t({ tags: ["misc", "dev"], groups: ["Alpha"] }), settings.tagColors, settings.folderColors)) === JSON.stringify({ name: "Dev", color: "#3b82f6" }));
check("category: else the project folder's picked colour", categoryOf(t({ groups: ["Alpha", "sub"] }), settings.tagColors, settings.folderColors).color === "#ff0000");
check("category: else the folder's hashed colour", categoryOf(t({ groups: ["Beta"] }), settings.tagColors, settings.folderColors).color === hashColor("Beta"));
check("category: none at the board's top level (drawn grey)", categoryOf(t({}), settings.tagColors, settings.folderColors) === undefined);

// ── markers and legend ──
const p3 = plan([
  task({ name: "Held", start: "2027-03-01", end: "2027-03-20", status: "hold", assignees: ["Dana"], tags: ["dev"] }),
  task({ name: "Late", start: "2027-01-05", end: "2027-02-01", assignees: ["Dana"], groups: ["Alpha"] }),
  task({ name: "Finished", start: "2027-01-05", end: "2027-02-01", status: "done", assignees: ["Eli"] }),
  task({ name: "Vendor", start: "2027-02-20", end: "2027-03-20", assignees: ["Eli"], tags: ["External/api"] }),
  task({ name: "Routine", start: "2027-01-01", end: "2027-03-31", assignees: ["Noa"], tags: ["שוטף"] }),
  task({ name: "Away", start: "2027-02-01", end: "2027-02-20", assignees: ["Ori"], tags: ["אי-זמינות"] }),
  task({ name: "WasAway", start: "2027-01-04", end: "2027-01-08", assignees: ["Ori"], tags: ["unavailable"] }), // past and still open
  task({ name: "Gate", end: "2027-02-10", milestone: true, assignees: ["Ori"] }),
]);
const b = (n) => barOf(p3, n);
check("at risk: deferred, or overdue and open; done work never", b("Held").risk && b("Late").risk && !b("Finished").risk && !b("Vendor").risk);
check("at risk: never an absence, even one past its dates", !b("WasAway").risk && b("WasAway").look === "unavailable");
check("done: muted, a ✓ before the name", b("Finished").look === "done" && b("Finished").text.startsWith("✓ "));
check("external dependency: #חיצוני / #external, nested too", b("Vendor").external && !b("Late").external);
check("routine and unavailability looks", b("Routine").look === "routine" && b("Away").look === "unavailable" && b("Vendor").look === "plain");
check("colours: tag, folder, grey", b("Held").color === "#3b82f6" && b("Late").color === "#ff0000" && b("Finished").color === "#9ca3af");
const gate = rowOf(p3, "Ori")[0].milestones[0];
check("a milestone: a diamond on its day, its name beside it", gate && near(gate.x + gate.w / 2, right - 40.5 * dayW) && gate.beside.text === "Gate" && gate.beside.x + gate.beside.w < gate.x);
const legend = p3.legend.map((e) => `${e.kind}:${e.text}`).join(" | ");
check("legend: the categories in use, then the markers in use", legend === "category:Alpha | category:Dev | risk:בסיכון | external:תלות בגורם חיצוני | unavailable:אי זמינות | routine:שוטף");
check("legend: markers nobody uses are left out", plan(base).legend.every((e) => e.kind === "category" || e.kind === "risk"));
check("legend: markers start a line of their own", p3.legend.find((e) => e.kind === "risk").y > p3.legend[0].y);

// ── text fits ──
const long = fitText("שם ארוך מאוד של משימה שלא נכנס", 0.5, 0.3, 13);
check("fit: too long even at the minimum: cut short with …", long.size === MIN_PT && long.text.endsWith("…") && (textEm(long.text) * MIN_PT) / 72 <= 0.5);
check("fit: room to spare: the largest size the height allows", fitText("קצר", 3, 0.3, 13).size === 13 && fitText("קצר", 3, 0.2, 13).size === 12);
check("fit: two lines when that reads clearly bigger", fitText("פיתוח ממשק ניהול", 0.9, 0.6, 13, true).text.includes("\n"));
const bars = [p1, p2, p3].flatMap((p) => p.pages.flatMap((pg) => pg.rows.flatMap((r) => r.bars)));
check(
  "every name fits its box: at least the minimum size, never wider than the room inside",
  bars.every((x) => x.text === "" || (x.size >= MIN_PT && x.text.split("\n").every((line) => (textEm(line) * x.size) / 72 <= x.w - x.padL - x.padR + 1e-9)))
);
const tiny = plan([task({ name: "Blip", start: "2027-03-10", end: "2027-03-10", assignees: ["Dana"] })], { start: "2027-01-01", end: "2027-06-30", label: "" });
const blip = barOf(tiny, "Blip");
check("a box too narrow for a few letters shows its name beside it", blip.text === "" && blip.beside?.text === "Blip" && blip.beside.x + blip.beside.w < blip.x);
const short = barOf(plan([task({ name: "Session timeout fix", start: "2027-02-01", end: "2027-02-05", assignees: ["Dana"] })]), "Session timeout fix");
check("a name too long for its box even small, over two lines, shows beside it whole, not cut short", short.text === "" && short.beside?.text === "Session timeout fix");

// ── pages ──
const crowd = Array.from({ length: 30 }, (_, i) => [
  task({ name: `p${i}a`, start: "2027-01-01", end: "2027-02-01", assignees: [`P${String(i).padStart(2, "0")}`] }),
  task({ name: `p${i}b`, start: "2027-01-15", end: "2027-03-01", assignees: [`P${String(i).padStart(2, "0")}`] }),
]).flat();
const p4 = plan(crowd);
const people = p4.pages.flatMap((pg) => pg.rows.map((r) => r.label.text));
check("too many rows for one slide go on over more, each person once, in order", p4.pages.length > 1 && people.length === 30 && people.join() === [...people].sort().join());
check("every page stays inside the slide", p4.pages.every((pg) => pg.bottom <= 7.5 - 0.3 + 1e-9 && pg.rows.every((r) => r.h >= 0.3 * 2)));
const one = plan(base);
check("a few rows fit one slide", one.pages.length === 1);

// ── the deck ──
const deck = await JSZip.loadAsync(await workPlanPptx(p4));
const slides = Object.keys(deck.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
const xml = await deck.file("ppt/slides/slide1.xml").async("string");
check("the deck: one slide per page", slides.length === p4.pages.length);
check("the deck: Hebrew, right to left, Arial", xml.includes("תוכנית עבודה") && xml.includes('rtl="1"') && xml.includes('lang="he-IL"') && xml.includes('typeface="Arial"'));
check("the deck: the presentation itself is right to left", (await deck.file("ppt/presentation.xml").async("string")).includes('rtl="1"'));
const mixed = plan([
  task({ name: "Config cleanup", start: "2027-01-04", end: "2027-02-26", assignees: ["Dana"], status: "done" }),
  task({ name: "עדכון שרת", start: "2027-01-04", end: "2027-02-26", assignees: ["דנה"] }),
]);
const mx = await (await JSZip.loadAsync(await workPlanPptx(mixed))).file("ppt/slides/slide1.xml").async("string");
const para = (text) => mx.split("</a:p>").find((p) => p.includes(`>${text}</a:t>`)) ?? "";
const ltr = (text) => para(text).includes('lang="en-US"') && !para(text).includes('rtl="1"');
const rtl = (text) => para(text).includes('lang="he-IL"') && para(text).includes('rtl="1"');
check("the deck: a text reads the way its first letter does: English left to right, ✓ and all; Hebrew right to left", ltr("✓ Config cleanup") && ltr("Dana") && rtl("עדכון שרת") && rtl("דנה") && rtl("תוכנית עבודה"));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
