// the work plan (תוכנית עבודה): everyone's work over a quarter or a half on 16:9 slides, time running from the right (the period's start) to
// the left, readable printed in greyscale or projected. The pure part: which tasks, which row and lane, and where every box goes (inches on
// PowerPoint's 13.33 × 7.5 widescreen slide); workplan-pptx.ts only draws it
import type { Task } from "./types";
import type { GanttSettings } from "./settings";
import { anchorEnd, anchorStart, statusGroupOf } from "./model";
import { dayIndex, dayToStr } from "./timeline";
import { byPerson, isSprint } from "./lanes";
import { isOverdue } from "./filter";
import { hashColor, toHex } from "./colors";

const DAY_MS = 86400000;

// the slide's words: the plan is Hebrew whatever the app's language
export const WP_TEXT = {
  title: "תוכנית עבודה",
  quarter: "רבעון",
  half: "חציון",
  unassigned: "ללא אחראי",
  risk: "בסיכון",
  external: "תלות בגורם חיצוני",
  unavailable: "אי זמינות",
  routine: "שוטף",
  today: "היום",
};

// ── geometry, in inches ──
export const SLIDE = { w: 13.333, h: 7.5 };
const M = 0.3; // the slide's margin
const LABEL_W = 1.5; // the people column, at the right
const TL_X = M; // the timeline, left of it
const TL_W = SLIDE.w - 2 * M - LABEL_W - 0.1;
const TITLE_W = 3.4; // the title block, top right; the legend fills the rest of the top, flowing from its right
const LEGEND = { left: M, right: SLIDE.w - M - TITLE_W - 0.3, y: M, step: 0.32, h: 0.26, size: 9, lines: 2 };
const HEB = { y: 1.0, h: 0.26 }; // the Hebrew months
const MON = { y: 1.3, h: 0.3 }; // the Gregorian months
const TOP = 1.68; // the rows, down to BOTTOM; today's label and the page number sit below
const BOTTOM = SLIDE.h - M - 0.24;
const LANE_MIN = 0.3; // below this a lane's text gets too small: the rows go on over more slides
const LANE_MAX = 0.6;
const ROW_PAD = 0.1; // above and below a row's lanes, together
const LANE_GAP = 0.07; // between stacked boxes
const GAP = 0.025; // between boxes end to end (one ending the day before the other starts)
const MIN_BOX = 0.16; // the narrowest box: one day of a half is 0.06 in
const MIN_INSIDE = 0.4; // a box with less room than this for its name (a few letters) shows it beside it instead
const DIAMOND = 0.2;
const BESIDE = { w: 1.8, size: 9 }; // a name beside its box or milestone
const BAR_PT = 13; // the largest name in a box
export const MIN_PT = 7;
// room kept inside a box beside its name: the padding, a clipped side's arrow, the external-dependency icon (at the start)
export const MARK = { pad: 0.04, clip: 0.1, icon: 0.2 };
const NEUTRAL = "#9ca3af"; // a task with no category

export interface PlanPeriod {
  start: string; // YYYY-MM-DD, inclusive
  end: string;
  label: string; // "רבעון 1 · 2027"
}

// this and the next calendar quarter, this and the next half
export function planPeriods(today: number): PlanPeriod[] {
  const d = new Date(today * DAY_MS);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  // the k-th block of `months` months from January this year (Date.UTC carries month 12 into next year)
  const block = (months: number, k: number, word: string): PlanPeriod => {
    const first = Date.UTC(y, k * months, 1);
    return {
      start: dayToStr(first / DAY_MS),
      end: dayToStr(Date.UTC(y, (k + 1) * months, 0) / DAY_MS),
      label: `${word} ${((k * months) % 12) / months + 1} · ${new Date(first).getUTCFullYear()}`,
    };
  };
  const q = Math.floor(m / 3);
  const h = Math.floor(m / 6);
  return [block(3, q, WP_TEXT.quarter), block(3, q + 1, WP_TEXT.quarter), block(6, h, WP_TEXT.half), block(6, h + 1, WP_TEXT.half)];
}

// ── text fitting (Arial) ──

// Arial's Hebrew letters א-ת, in hundredths of an em
const HEBREW_EM = [56, 54, 40, 51, 60, 25, 38, 60, 59, 25, 51, 46, 46, 60, 60, 25, 35, 57, 53, 57, 55, 46, 48, 55, 51, 69, 64];

// a character's width in Arial, in ems (anything but Hebrew rounded up)
function charEm(c: string): number {
  const code = c.charCodeAt(0);
  if (code >= 0x5d0 && code <= 0x5ea) return HEBREW_EM[code - 0x5d0] / 100;
  if (code >= 0x591 && code <= 0x5c7) return 0; // niqqud sits on its letter
  if (c === " ") return 0.28;
  if ("ilIjft.,:;'|!()[]׳״-/".includes(c)) return 0.34;
  if (c === "…") return 1;
  if ("mwMW@%".includes(c)) return 0.9;
  if (/[A-Z✓]/.test(c)) return 0.8;
  return 0.58;
}
// a line's width in ems, as PowerPoint lays it out: about 0.3 em more than its letters (measured), and a little to spare
export function textEm(text: string, bold = false): number {
  let em = 0.3;
  for (const c of text) em += charEm(c);
  return em * (bold ? 1.08 : 1.02);
}

export interface Fit {
  text: string; // as drawn: maybe split over two lines ("\n"), or cut short with "…"
  size: number; // pt
}
const LINE = 1.2; // a line's height over its font size

// the largest size up to `max` at which `text` fits a w × h box (inches): on one line, or over two (split at the space that leaves the
// shorter longest line) when `two` and that reads clearly bigger. Below MIN_PT it's one line at MIN_PT cut short with "…" ("" when not
// even that fits)
export function fitText(text: string, w: number, h: number, max: number, two = false, bold = false): Fit {
  const wPt = w * 72;
  const hPt = h * 72;
  const one = Math.min(max, wPt / textEm(text, bold), hPt / LINE);
  let split = "";
  let widest = Infinity;
  const words = text.split(" ");
  for (let i = 1; two && i < words.length; i++) {
    const [a, b] = [words.slice(0, i).join(" "), words.slice(i).join(" ")];
    const em = Math.max(textEm(a, bold), textEm(b, bold));
    if (em < widest) [split, widest] = [`${a}\n${b}`, em];
  }
  const size2 = Math.min(max, wPt / widest, hPt / (2 * LINE));
  // two lines when that reads clearly bigger, or when one line can't be read at all and two can
  const best = split && (size2 > one + 1 || (one < MIN_PT && size2 >= MIN_PT)) ? { text: split, size: size2 } : { text, size: one };
  if (best.size >= MIN_PT) return { text: best.text, size: Math.floor(best.size * 2) / 2 };
  if (hPt / LINE < MIN_PT) return { text: "", size: MIN_PT };
  const chars = [...text];
  while (chars.length && textEm(chars.join("") + "…", bold) * MIN_PT > wPt) chars.pop();
  return { text: chars.length ? chars.join("").trimEnd() + "…" : "", size: MIN_PT };
}

// ── what a task shows as ──

export interface Category {
  name: string;
  color: string; // #rrggbb
}

// a task's category ("אופי משימה"): its first tag with a colour in the settings, else its project folder (the first under the board's)
// with that folder's colour (picked, else hashed from the name), else none (drawn grey)
export function categoryOf(t: Task, tagColors: { name: string; color: string }[], folderColors: { name: string; color: string }[]): Category | undefined {
  for (const tag of t.tags) {
    const c = tagColors.find((x) => x.name.toLowerCase() === tag.toLowerCase());
    if (c?.color) return { name: c.name, color: toHex(c.color) };
  }
  const g = t.groups[0];
  return g ? { name: g, color: toHex(folderColors.find((c) => c.name === g)?.color || hashColor(g)) } : undefined;
}

// tagged with one of `names` (any case), or a nested tag under one ("external/vendor")
function tagged(t: Task, ...names: string[]): boolean {
  return t.tags.some((x) => names.some((n) => x.toLowerCase() === n || x.toLowerCase().startsWith(n + "/")));
}

// plain: the category's tint; done: muted with a ✓; routine (שוטף): dark; unavailable (אי זמינות): neutral
export type Look = "plain" | "done" | "routine" | "unavailable";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Label extends Box {
  text: string;
  size: number; // pt
}
// a name beside its milestone or box, aligned towards it
export type Side = Label & { align: "left" | "right" };
export interface Bar extends Label {
  path: string;
  color: string; // the category's colour (#rrggbb; grey without one)
  look: Look;
  risk: boolean; // deferred, or overdue: a dashed outline
  external: boolean; // waits on someone outside: an icon at its start (right)
  clipStart: boolean; // began before the period: runs into the right edge, marked
  clipEnd: boolean; // ends after it: runs into the left edge, marked
  padL: number; // inches kept clear inside, beside the name
  padR: number;
  beside?: Side; // its name, when the box is too narrow for it (text is then "")
}
export interface Milestone extends Box {
  path: string;
  color: string;
  risk: boolean;
  done: boolean;
  beside: Side; // its name
}
export interface PlanRow extends Box {
  label: Label; // the person, in the column at the right
  bars: Bar[];
  milestones: Milestone[];
}
export interface PlanPage {
  rows: PlanRow[];
  bottom: number; // where its last row ends
}
export type LegendKind = "category" | "risk" | "external" | "unavailable" | "routine";
export interface LegendItem extends Label {
  kind: LegendKind;
  color: string; // a category's colour
}
// one slide per page; each repeats the title, legend and month headers
export interface WorkPlan {
  title: Label;
  subtitle: Label; // the period and the board
  legend: LegendItem[];
  hebMonths: Label[];
  months: Label[];
  grid: number[]; // the month boundaries (x)
  today?: number; // x, when today is inside the period
  top: number; // where the rows start
  pages: PlanPage[];
}

export interface WorkPlanInput {
  tasks: Task[]; // the board's tasks; what's left out is decided here
  settings: Pick<GanttSettings, "statuses" | "tagColors" | "folderColors">;
  period: PlanPeriod;
  board: string; // its name, under the title
  today: number; // day index
}

// a task as it'll be drawn: its days within the period (0 = the first), what it looks like
interface Item {
  t: Task;
  a: number;
  b: number;
  clipStart: boolean;
  clipEnd: boolean;
  cat?: Category;
  look: Look;
  done: boolean;
  risk: boolean;
  external: boolean;
  name: string; // ✓ first when done
  padL: number;
  padR: number;
  inside: number; // the room for its name inside its box, in inches
  beside?: Fit; // its name beside it: a milestone's, or a box's too narrow (or, in a low lane, too short) for it
}
// where it sits in its row: its box (the diamond, or its days, at least MIN_BOX wide) and [from, to) with a name beside it, in days; its lane
interface Placed {
  it: Item;
  box: [number, number];
  from: number;
  to: number;
  nameLeft?: boolean; // a name beside it runs left (later); at the period's end, right instead
  lane: number;
}

// lay the plan out. Tasks: not sprint notes, cancelled or undated, and overlapping the period (cut at its edges). One row per person by
// name, a shared task in each of theirs, then those with nobody; inside a row, boxes stack into lanes so none overlap
export function buildWorkPlan({ tasks, settings, period, board, today }: WorkPlanInput): WorkPlan {
  const s = dayIndex(period.start);
  const n = dayIndex(period.end) - s + 1;
  const dayW = TL_W / n;
  const xAt = (p: number) => TL_X + TL_W - p * dayW; // p days into the period, right to left

  const items: Item[] = [];
  for (const t of tasks) {
    const group = statusGroupOf(settings.statuses, t.status);
    const first = anchorStart(t) ?? anchorEnd(t);
    const last = anchorEnd(t) ?? first;
    if (isSprint(t) || group === "cancelled" || !first || !last) continue;
    const [a, b] = [dayIndex(first) - s, dayIndex(last) - s].sort((x, y) => x - y);
    if (!(b >= 0 && a < n)) continue; // outside the period (or an unreadable date)
    const done = group === "completed";
    const routine = tagged(t, "שוטף", "routine");
    const unavailable = tagged(t, "אי-זמינות", "unavailable");
    const external = tagged(t, "חיצוני", "external");
    const name = (done ? "✓ " : "") + t.name;
    const [clipStart, clipEnd] = [a < 0, b >= n];
    const padL = MARK.pad + (clipEnd ? MARK.clip : 0);
    const padR = MARK.pad + (clipStart ? MARK.clip : 0) + (external ? MARK.icon : 0);
    const inside = Math.max(MIN_BOX, (Math.min(b, n - 1) - Math.max(a, 0) + 1) * dayW) - 2 * GAP - padL - padR;
    // a name too wide for its box even at the smallest size over two lines goes beside it whole, rather than cut short
    const whole = fitText(name, inside, 1, BAR_PT, true).text.replace("\n", " ") === name;
    items.push({
      t,
      a: Math.max(a, 0),
      b: Math.min(b, n - 1),
      clipStart,
      clipEnd,
      cat: categoryOf(t, settings.tagColors, settings.folderColors),
      look: routine ? "routine" : unavailable ? "unavailable" : done ? "done" : "plain",
      done,
      risk: !unavailable && (group === "deferred" || isOverdue(t, settings.statuses, today)), // an absence can't slip
      external,
      name,
      padL,
      padR,
      inside,
      beside: t.milestone || inside < MIN_INSIDE || !whole ? fitText(name, BESIDE.w, LANE_MIN - LANE_GAP, BESIDE.size) : undefined,
    });
  }

  // where a task sits: its box (a milestone's diamond, else its days, at least MIN_BOX wide), and a name beside it running left
  // (later) unless that would leave the period
  const span = (it: Item): Omit<Placed, "lane"> => {
    const min = MIN_BOX / dayW;
    const from = it.t.milestone ? it.a + 0.5 - DIAMOND / 2 / dayW : it.b + 1 - it.a >= min ? it.a : Math.min(Math.max(0, (it.a + it.b + 1 - min) / 2), n - min);
    const to = it.t.milestone ? from + DIAMOND / dayW : Math.max(it.b + 1, from + min);
    const box: [number, number] = [from, to];
    if (!it.beside) return { it, box, from, to };
    const name = (0.05 + nameW(it.beside)) / dayW;
    return to + name <= n ? { it, box, from, to: to + name, nameLeft: true } : { it, box, from: Math.max(0, from - name), to, nameLeft: false };
  };
  // greedy interval partitioning: by start, each into the first lane already free (so no two boxes in a lane share a day)
  const pack = (row: Item[]): { placed: Placed[]; lanes: number } => {
    const ends: number[] = [];
    const placed = row
      .map(span)
      .sort((x, y) => x.from - y.from || y.to - x.to)
      .map((p) => {
        let lane = ends.findIndex((end) => end <= p.from + 1e-9);
        if (lane < 0) lane = ends.push(0) - 1;
        ends[lane] = p.to;
        return { ...p, lane };
      });
    return { placed, lanes: ends.length };
  };
  const byTask = new Map(items.map((it) => [it.t, it]));
  const room = BOTTOM - TOP;
  const cap = Math.floor((room - ROW_PAD) / LANE_MIN);
  // the rows laid out with the names as they stand, and the lane height that comes of it
  const lay = () => {
    const rows = byPerson(items.map((it) => it.t), [], WP_TEXT.unassigned).map(([who, ts]) => ({ who, ...pack(ts.map((t) => byTask.get(t)!)) }));
    // one slide while every lane gets LANE_MIN, else as many as it takes (a row taller than a slide goes on over the next, by lanes);
    // every slide gets the lane height of the fullest one, up to LANE_MAX
    const chunks = rows.flatMap((r) =>
      Array.from({ length: Math.max(1, Math.ceil(r.lanes / cap)) }, (_, k) => ({
        who: r.who,
        lanes: Math.min(cap, r.lanes - k * cap),
        placed: r.placed.filter((p) => Math.floor(p.lane / cap) === k).map((p) => ({ ...p, lane: p.lane - k * cap })),
      }))
    );
    const pageRows: (typeof chunks)[] = [[]];
    let used = 0;
    for (const c of chunks) {
      const h = c.lanes * LANE_MIN + ROW_PAD;
      if (used + h > room + 1e-9 && pageRows[pageRows.length - 1].length) {
        pageRows.push([]);
        used = 0;
      }
      pageRows[pageRows.length - 1].push(c);
      used += h;
    }
    const laneH = Math.min(LANE_MAX, ...pageRows.map((p) => (room - p.length * ROW_PAD) / Math.max(1, p.reduce((sum, c) => sum + c.lanes, 0))));
    return { pageRows, laneH };
  };
  // a name that fits its box on two lines is cut short when the lanes come out too low for two lines. Such names go beside their
  // boxes too and the rows are laid out again; that can add lanes and lower them further, so until nothing is cut (each round moves
  // at least one name out, so it ends)
  let { pageRows, laneH } = lay();
  for (let round = 0; round < items.length; round++) {
    const cut = items.filter((it) => !it.beside && fitText(it.name, it.inside, laneH - LANE_GAP - 0.02, BAR_PT, true).text.replace("\n", " ") !== it.name);
    if (!cut.length) break;
    for (const it of cut) it.beside = fitText(it.name, BESIDE.w, LANE_MIN - LANE_GAP, BESIDE.size);
    ({ pageRows, laneH } = lay());
  }

  const pages = pageRows.map((chunkRows): PlanPage => {
    let y = TOP;
    const out = chunkRows.map((c): PlanRow => {
      const h = c.lanes * laneH + ROW_PAD;
      const lh = h - 0.06;
      const row: PlanRow = {
        x: TL_X,
        y,
        w: SLIDE.w - M - TL_X,
        h,
        label: { x: SLIDE.w - M - LABEL_W, y: y + 0.03, w: LABEL_W, h: lh, ...fitText(c.who, LABEL_W - 0.16, lh - 0.04, 13, true, true) },
        bars: [],
        milestones: [],
      };
      for (const { it, box, nameLeft, lane } of c.placed) {
        const top = y + ROW_PAD / 2 + lane * laneH + LANE_GAP / 2;
        const bh = laneH - LANE_GAP;
        const color = it.cat?.color ?? NEUTRAL;
        const [right, left] = [xAt(box[0]), xAt(box[1])];
        let beside: Side | undefined;
        if (it.beside) {
          const w = nameW(it.beside);
          beside = { ...it.beside, x: nameLeft ? left - 0.05 - w : right + 0.05, y: top, w, h: bh, align: nameLeft ? "right" : "left" };
        }
        if (it.t.milestone) {
          const d = Math.min(DIAMOND, bh);
          const cx = xAt(it.a + 0.5);
          row.milestones.push({ path: it.t.path, color, risk: it.risk, done: it.done, x: cx - d / 2, y: top + (bh - d) / 2, w: d, h: d, beside: beside! });
          continue;
        }
        const x0 = left + (it.clipEnd ? 0 : GAP);
        const x1 = right - (it.clipStart ? 0 : GAP);
        const fit = beside ? { text: "", size: MIN_PT } : fitText(it.name, x1 - x0 - it.padL - it.padR, bh - 0.02, BAR_PT, true);
        row.bars.push({ path: it.t.path, color, look: it.look, risk: it.risk, external: it.external, clipStart: it.clipStart, clipEnd: it.clipEnd, padL: it.padL, padR: it.padR, x: x0, y: top, w: x1 - x0, h: bh, ...fit, beside });
      }
      y += h;
      return row;
    });
    return { rows: out, bottom: y };
  });

  // the month headers: each month a box over its days (Hebrew months by their real dates); a name that doesn't fit whole is left out
  const heb = new Intl.DateTimeFormat("he-u-ca-hebrew", { month: "long", timeZone: "UTC" });
  const greg = new Intl.DateTimeFormat("he", { month: "long", timeZone: "UTC" });
  const months = (fmt: Intl.DateTimeFormat, band: { y: number; h: number }, size: number): Label[] =>
    monthSpans(s, n, (day) => fmt.format(new Date(day * DAY_MS))).map(({ name, from, to }) => {
      const w = (to - from) * dayW - 0.04;
      const fit = fitText(name, w - 0.08, band.h, size, false, true);
      return { x: xAt(to) + 0.02, y: band.y, w, h: band.h, text: fit.text === name ? name : "", size: fit.size };
    });
  const gregMonths = months(greg, MON, 12);

  // the legend: the categories coloured boxes actually show, by name, then the markers in use
  const cats = new Map<string, Category>();
  for (const it of items) if (it.cat && (it.look === "plain" || it.look === "done")) cats.set(`${it.cat.name}\n${it.cat.color}`, it.cat);
  const entries: { kind: LegendKind; text: string; color: string }[] = [
    ...[...cats.values()].sort((x, y) => x.name.localeCompare(y.name)).map((c) => ({ kind: "category" as const, text: c.name, color: c.color })),
    ...(["risk", "external", "unavailable", "routine"] as const)
      .filter((k) => items.some((it) => (k === "risk" ? it.risk : k === "external" ? it.external : it.look === k)))
      .map((k) => ({ kind: k, text: WP_TEXT[k], color: NEUTRAL })),
  ];

  return {
    title: { x: SLIDE.w - M - TITLE_W, y: M - 0.06, w: TITLE_W, h: 0.5, ...fitText(WP_TEXT.title, TITLE_W, 0.5, 26, false, true) },
    subtitle: { x: SLIDE.w - M - TITLE_W, y: 0.68, w: TITLE_W, h: 0.28, ...fitText(board ? `${period.label} · ${board}` : period.label, TITLE_W, 0.28, 13) },
    legend: flowLegend(entries),
    hebMonths: months(heb, HEB, 11),
    months: gregMonths,
    grid: gregMonths.slice(1).map((m) => m.x + m.w + 0.02),
    today: today >= s && today < s + n ? xAt(today - s + 0.5) : undefined,
    top: TOP,
    pages,
  };
}

// a fitted name's width (inches)
function nameW(f: Fit): number {
  return (textEm(f.text) * f.size) / 72 + 0.02;
}

// runs of days with the same month name: [from, to) in days from the period's start
export function monthSpans(start: number, days: number, name: (day: number) => string): { name: string; from: number; to: number }[] {
  const out: { name: string; from: number; to: number }[] = [];
  for (let p = 0; p < days; p++) {
    const m = name(start + p);
    const last = out[out.length - 1];
    if (last && last.name === m) last.to = p + 1;
    else out.push({ name: m, from: p, to: p + 1 });
  }
  return out;
}

// the legend's entries side by side from its right edge, onto the next line when one is full; the markers start a line of their own
// when there's one to spare
function flowLegend(entries: { kind: LegendKind; text: string; color: string }[]): LegendItem[] {
  const out: LegendItem[] = [];
  let x = LEGEND.right;
  let line = 0;
  for (const [i, e] of entries.entries()) {
    const fit = fitText(e.text, 2.5, LEGEND.h, LEGEND.size);
    const w = nameW(fit) + (e.kind === "external" ? MARK.icon + 0.04 : 0.2);
    const markers = e.kind !== "category" && entries[i - 1]?.kind === "category" && line < LEGEND.lines - 1;
    if (x < LEGEND.right && (x - w < LEGEND.left || markers)) {
      line++;
      x = LEGEND.right;
    }
    // shortcut: entries past the second line are left out; a third would need the month headers moved down
    if (line >= LEGEND.lines) break;
    out.push({ ...e, ...fit, x: x - w, y: LEGEND.y + line * LEGEND.step, w, h: LEGEND.h });
    x -= w + 0.14;
  }
  return out;
}
