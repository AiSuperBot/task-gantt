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
// What a name's width is checked against is the font itself, not the plugin's own estimate: Arial's advance widths in thousandths of
// an em, read from arial.ttf and arialbd.ttf ([regular, bold]; the printable ASCII characters from the space on, then א to ת)
const ARIAL = {
  ascii: [
    [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584],
    [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584],
  ],
  hebrew: [
    [563, 542, 399, 508, 602, 247, 382, 599, 590, 247, 509, 461, 463, 599, 601, 247, 353, 574, 529, 566, 546, 461, 479, 550, 509, 694, 643],
    [583, 576, 457, 550, 614, 273, 413, 616, 626, 273, 521, 491, 496, 611, 630, 273, 386, 613, 543, 594, 587, 500, 512, 573, 521, 715, 673],
  ],
  // the last two aren't in Arial: PowerPoint draws them from Segoe UI Symbol and Segoe UI Emoji
  other: { "…": [1000, 1000], "—": [1000, 1000], "–": [556, 556], "׳": [236, 276], "״": [417, 504], "’": [222, 278], "→": [1000, 1000], "✓": [749, 749], "🚀": [1373, 1373] },
};
const arialEm = (text, bold = false) =>
  [...text].reduce((sum, c) => {
    const k = c.codePointAt(0);
    const w = k >= 32 && k <= 126 ? ARIAL.ascii[+bold][k - 32] : k >= 0x5d0 && k <= 0x5ea ? ARIAL.hebrew[+bold][k - 0x5d0] : ARIAL.other[c]?.[+bold];
    if (w === undefined) throw new Error(`no Arial width for ${c}`);
    return sum + w / 1000;
  }, 0);
// as wide as PowerPoint draws a line at a size: its letters and about 0.3 em more (measured), in inches
const drawn = (line, size, bold = false) => ((arialEm(line, bold) + 0.3) * size) / 72;
const measured = [...Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)), ...Array.from({ length: 27 }, (_, i) => String.fromCharCode(0x5d0 + i)), ...Object.keys(ARIAL.other)];
check("width: no character is taken to be narrower than Arial draws it, regular or bold", measured.every((c) => [false, true].every((b) => textEm(c, b) - textEm("", b) >= arialEm(c, b) - 1e-9)));
check("width: a letter of a script written in squares takes at least a square", ["日", "한"].every((c) => textEm(c) - textEm("") >= 1));
const long = fitText("שם ארוך מאוד של משימה שלא נכנס", 0.5, 0.3, 13);
check("fit: too long even at the minimum: cut short with …", long.size === MIN_PT && long.text.endsWith("…") && drawn(long.text, MIN_PT) <= 0.5);
check("fit: room to spare: the largest size the height allows", fitText("קצר", 3, 0.3, 13).size === 13 && fitText("קצר", 3, 0.2, 13).size === 12);
check("fit: two lines when that reads clearly bigger", fitText("פיתוח ממשק ניהול", 0.9, 0.6, 13, true).text.includes("\n"));
const bars = [p1, p2, p3].flatMap((p) => p.pages.flatMap((pg) => pg.rows.flatMap((r) => r.bars)));
check(
  "every name fits its box: at least the minimum size, never drawn wider than the room inside",
  bars.every((x) => x.text === "" || (x.size >= MIN_PT && x.text.split("\n").every((line) => drawn(line, x.size) <= x.w - x.padL - x.padR + 1e-9)))
);
check("a name beside its box has the room it is drawn in", bars.some((x) => x.beside) && bars.every((x) => !x.beside || drawn(x.beside.text, x.beside.size) <= x.beside.w + 1e-9));
const rows3 = [p1, p2, p3].flatMap((p) => p.pages.flatMap((pg) => pg.rows));
check("a person's name fits its column, in bold", rows3.length > 0 && rows3.every((r) => r.label.text.split("\n").every((line) => drawn(line, r.label.size, true) <= r.label.w + 1e-9)));
const tiny = plan([task({ name: "Blip", start: "2027-03-10", end: "2027-03-10", assignees: ["Dana"] })], { start: "2027-01-01", end: "2027-06-30", label: "" });
const blip = barOf(tiny, "Blip");
check("a box too narrow for a few letters shows its name beside it", blip.text === "" && blip.beside?.text === "Blip" && blip.beside.x + blip.beside.w < blip.x);
const short = barOf(plan([task({ name: "Session timeout fix", start: "2027-02-01", end: "2027-02-05", assignees: ["Dana"] })]), "Session timeout fix");
check("a name too long for its box even small, over two lines, shows beside it whole, not cut short", short.text === "" && short.beside?.text === "Session timeout fix");
const wordy = "Migrate customer database to new cluster";
const wide = barOf(plan([task({ name: wordy, start: "2027-02-01", end: "2027-02-03", assignees: ["Dana"] })]), wordy);
check("a long name beside its box is whole too (forty letters)", wide.beside?.text === wordy && wide.beside.size >= MIN_PT);
check("fit: two lines when one line can't be read at all, even if two aren't clearly bigger (was cut short: DB Adap…)", fitText("DB Adapter", 0.608, 0.25, 13, true).text === "DB\nAdapter" && fitText("DB Adapter", 0.608, 0.25, 13, true).size >= MIN_PT);
// a crowded half-year: seventeen boxes over the same days for one person, so the lanes come out at their lowest
const HALF = { start: "2027-01-01", end: "2027-06-30", label: "" };
const busy = plan(Array.from({ length: 17 }, (_, i) => task({ name: i ? `Job ${i}` : "DB Adapter", start: "2027-03-01", end: "2027-03-12", assignees: ["P0"] })), HALF);
const busyBars = busy.pages.flatMap((pg) => pg.rows.flatMap((r) => r.bars));
const db = barOf(busy, "DB Adapter");
const roomIn = db.w - db.padL - db.padR;
check("the case: the name fits its box over two lines, but the lanes are too low for two lines", fitText("DB Adapter", roomIn, 1, 13, true).text === "DB\nAdapter" && fitText("DB Adapter", roomIn, db.h - 0.02, 13, true).text.endsWith("…"));
check("then the name goes beside its box, whole; no name on the slide is cut short", db.text === "" && db.beside?.text === "DB Adapter" && busyBars.every((x) => !x.text.endsWith("…")));

// ── pages ──
const crowd = Array.from({ length: 30 }, (_, i) => [
  task({ name: `p${i}a`, start: "2027-01-01", end: "2027-02-01", assignees: [`P${String(i).padStart(2, "0")}`] }),
  task({ name: `p${i}b`, start: "2027-01-15", end: "2027-03-01", assignees: [`P${String(i).padStart(2, "0")}`] }),
]).flat();
const p4 = plan(crowd);
const people = p4.pages.flatMap((pg) => pg.rows.map((r) => r.label.text));
check("too many rows for one slide go on over more, each person once, in order", p4.pages.length > 1 && people.length === 30 && people.join() === [...people].sort().join());
// the rows end 0.24 in above the bottom margin: today's label and the page number sit there
check("every page's rows stay above the footer", p4.pages.every((pg) => pg.bottom <= 7.5 - 0.3 - 0.24 + 1e-9 && pg.rows.every((r) => r.h >= 0.3 * 2)));
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
