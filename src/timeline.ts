import { moment } from "obsidian";
import { ZoomMode, Task, DateFormat, DateValue, DateOp } from "./types";

const MS_PER_DAY = 86400000;
// the narrowest gap between two axis labels (px); week and month labels run long in some languages
const MIN_TICK_GAP = 36;
const MIN_TICK_GAP_WIDE = 56;

// parse to a UTC day index
export function dayIndex(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map((x) => parseInt(x, 10));
  return Math.floor(Date.UTC(y, (m || 1) - 1, d || 1) / MS_PER_DAY);
}

// day index back to date string
export function dayToStr(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

// today in the configured timezone ("system" = the device's calendar, or a fixed offset like "+09:00"); counting in UTC would
// give yesterday until 9 am in Japan, and tomorrow on a US evening
export function todayIndex(now = new Date(), tz = "system"): number {
  const offset = fixedOffset(tz);
  if (offset == null) return Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / MS_PER_DAY);
  return Math.floor((now.getTime() + offset * 60000) / MS_PER_DAY);
}

// a fixed-offset timezone ("+09:00", …) in minutes; "system" gives null (the device's offset applies, case by case)
export function fixedOffset(tz: string): number | null {
  const m = tz.match(/^([+-])(\d{2}):(\d{2})$/);
  return m ? (m[1] === "-" ? -1 : 1) * (+m[2] * 60 + +m[3]) : null;
}

// format an ISO date for display. "ddd D MMM" is read at a glance: the month by name (day and month can't be mixed up), the
// weekday for near-term planning, and the year only outside the current one ("Tue 24 Nov", "24 Nov 2027"), in Obsidian's language
export function formatDate(iso: string | undefined, fmt: DateFormat, today = todayIndex()): string {
  if (!iso) return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso; // pass unparseable values through
  const [, y, mo, d] = m;
  switch (fmt) {
    case "ddd D MMM":
      return glance(new Date(today * MS_PER_DAY).getUTCFullYear() === +y).format(new Date(Date.UTC(+y, +mo - 1, +d)));
    case "DD/MM/YYYY":
      return `${d}/${mo}/${y}`;
    case "MM/DD/YYYY":
      return `${mo}/${d}/${y}`;
    default:
      return `${y}/${mo}/${d}`;
  }
}

// the glance formatters, built once per language (English writes the day first, "Tue 24 Nov")
const glanceFormats = new Map<string, Intl.DateTimeFormat>();
function glance(thisYear: boolean): Intl.DateTimeFormat {
  const lang = moment.locale();
  const key = `${lang}|${thisYear}`;
  let f = glanceFormats.get(key);
  if (!f) {
    const o: Intl.DateTimeFormatOptions = thisYear ? { weekday: "short", day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" };
    try {
      f = new Intl.DateTimeFormat(lang.startsWith("en") ? "en-GB" : lang, { ...o, timeZone: "UTC" });
    } catch {
      f = new Intl.DateTimeFormat(undefined, { ...o, timeZone: "UTC" }); // a language name Intl doesn't know
    }
    glanceFormats.set(key, f);
  }
  return f;
}

// ── date-filter resolution & matching ──

// resolve a DateValue to day index(es), relative to `today`; recomputing each
// render makes relative/preset values follow the current date automatically.
export function resolveDateValue(v: DateValue, today: number = todayIndex()): { from: number; to?: number } {
  switch (v.kind) {
    case "preset": {
      const off = v.preset === "yesterday" ? -1 : v.preset === "tomorrow" ? 1 : 0;
      return { from: today + off };
    }
    case "specific":
      return { from: dayIndex(v.date) };
    case "relative": {
      const n = (v.dir === "ago" ? -1 : 1) * v.amount;
      if (v.unit === "day") return { from: today + n };
      if (v.unit === "week") return { from: today + n * 7 };
      // month uses calendar arithmetic, the day capped at the month's last day (Jan 31 + 1 month = Feb 28)
      const d = new Date(today * MS_PER_DAY);
      const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n + 1, 0)).getUTCDate();
      return { from: Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, Math.min(d.getUTCDate(), last)) / MS_PER_DAY) };
    }
    case "range":
      return { from: dayIndex(v.from), to: dayIndex(v.to) };
  }
}

// does a task's date (day index or undefined) satisfy one date filter?
// tasks without the date are excluded for every operator except `empty`;
// an incomplete filter (missing value) is treated as no constraint.
export function matchDate(dayIdx: number | undefined, f: { op: DateOp; value?: DateValue }, today: number = todayIndex()): boolean {
  if (f.op === "empty") return dayIdx === undefined;
  if (f.op === "notEmpty") return dayIdx !== undefined;
  if (!f.value) return true; // incomplete filter = no effect
  if (dayIdx === undefined) return false; // exclude tasks lacking the date
  const r = resolveDateValue(f.value, today);
  if (f.value.kind === "range") return r.to !== undefined && dayIdx >= r.from && dayIdx <= r.to;
  switch (f.op) {
    case "is": return dayIdx === r.from;
    case "before": return dayIdx < r.from;
    case "after": return dayIdx > r.from;
    case "onOrBefore": return dayIdx <= r.from;
    case "onOrAfter": return dayIdx >= r.from;
    default: return true;
  }
}

// pixels per day per zoom
// Fit is computed from the container width elsewhere; here it falls back to the Week scale
export function pxPerDay(zoom: ZoomMode): number {
  switch (zoom) {
    case "Day":
      return 36;
    case "Week":
      return 16;
    case "Month":
      return 5;
    case "Fit":
      return 16;
  }
}

export interface DateRange {
  min: number; // first day index
  max: number; // last day index
}

// compute the visible range with padding
export function computeRange(tasks: Task[], today = todayIndex()): DateRange {
  const days: number[] = [];
  // drop NaN day indices so a bad date can't break the whole range
  // dates more than 20 years from today (a mistyped year, say) stay out of the range; the task still shows in the table
  const push = (s?: string) => {
    if (!s) return;
    const i = dayIndex(s);
    if (Number.isFinite(i) && Math.abs(i - today) <= 20 * 366) days.push(i);
  };
  for (const t of tasks) {
    push(t.start);
    push(t.end);
  }
  if (days.length === 0) {
    return { min: today - 7, max: today + 30 };
  }
  return { min: Math.min(...days) - 3, max: Math.max(...days) + 7 };
}

// ── the endless timeline: as the horizontal scroll nears an edge, days are added before or after the tasks' range ──

// the days added before and after the tasks' range
export interface RangePad {
  before: number;
  after: number;
}

// the days added each time an edge comes near (Day: four weeks, Week: three months, Month: a year); Fit doesn't grow
export function extendChunk(zoom: ZoomMode): number {
  return zoom === "Day" ? 28 : zoom === "Week" ? 91 : zoom === "Month" ? 365 : 0;
}

// the most scrolling can add on one side (Day: a year, Week: three years, Month: ten); keeps the DOM and drawing bounded
export function extendLimit(zoom: ZoomMode): number {
  return zoom === "Day" ? 366 : zoom === "Week" ? 3 * 366 : zoom === "Month" ? 10 * 366 : 0;
}

// the pad grown on one side by at least `need` days (what it takes to leave the edge zone), rounded up to whole chunks; stops at the limit, null when it can't grow
export function growPad(pad: RangePad, side: keyof RangePad, zoom: ZoomMode, need = 0): RangePad | null {
  const chunk = extendChunk(zoom);
  if (!chunk) return null;
  const next = Math.min(extendLimit(zoom), pad[side] + Math.max(1, Math.ceil(need / chunk)) * chunk);
  return next > pad[side] ? { ...pad, [side]: next } : null;
}

// the shown range: the tasks' range plus the pad
export function padRange(r: DateRange, pad: RangePad): DateRange {
  return { min: r.min - pad.before, max: r.max + pad.after };
}

// the window's left edge, moved as little as possible for [x0, x1] to show inside [left, left + view] with `pad` to spare;
// a span longer than the window stays put while it crosses the window, and shows its start when it doesn't
export function revealSpan(left: number, view: number, x0: number, x1: number, pad: number): number {
  if (x1 - x0 > view - 2 * pad) return x1 < left + pad || x0 > left + view - pad ? x0 - pad : left;
  return Math.min(Math.max(left, x1 + pad - view), x0 - pad);
}

// a pad that brings `day` into the shown range with a chunk to spare; used for jumps (Today, a zoom change), so it may exceed the limit
export function padToCover(base: DateRange, pad: RangePad, day: number, zoom: ZoomMode): RangePad {
  const chunk = extendChunk(zoom);
  return { before: Math.max(pad.before, Math.ceil(base.min - day) + chunk), after: Math.max(pad.after, Math.ceil(day - base.max) + chunk) };
}

// which edge is within `margin` of the view, if any (the left one first)
export function nearEdge(scrollLeft: number, clientWidth: number, scrollWidth: number, margin: number): keyof RangePad | null {
  if (scrollLeft < margin) return "before";
  if (scrollLeft + clientWidth > scrollWidth - margin) return "after";
  return null;
}

// ── progress line ──

// one row's input for the progress line; rows without a bar (group rows, no dates) omit startX
export interface ProgressLineRow {
  startX?: number; // bar's left edge
  width?: number; // bar width (0 for a milestone)
  progress?: number; // 0-100 (unset = not started)
}

export interface Point {
  x: number;
  y: number;
}

// x for one row: bending left of basisX means behind schedule, right means ahead
export function progressLineX(row: ProgressLineRow, basisX: number): number {
  if (row.startX === undefined) return basisX; // no bar, pass through
  const p = row.progress ?? 0;
  if (p >= 100) return basisX; // done = no deviation
  // not started: behind as far as the start date if it has passed, otherwise no deviation
  if (p <= 0) return Math.min(basisX, row.startX);
  return row.startX + ((row.width ?? 0) * p) / 100;
}

// build the polyline: pinned to basisX at both ends, one point at each row's center
export function buildProgressLine(rows: ProgressLineRow[], basisX: number, rowH: number, height: number): Point[] {
  const pts: Point[] = [{ x: basisX, y: 0 }];
  rows.forEach((row, i) => pts.push({ x: progressLineX(row, basisX), y: i * rowH + rowH / 2 }));
  pts.push({ x: basisX, y: height });
  return pts;
}

export interface Tick {
  x: number;
  label: string;
  major: boolean; // month boundary
}

// generate header ticks (Day: every day, Week: each week's first day (weekStart), on an even rhythm — the month band above marks
// where months turn, Month: month starts); `label` writes the text, so the caller owns the locale. A tick too close to the previous
// one is dropped, except that a month start (major) replaces the regular tick it would collide with
export function buildTicks(range: DateRange, zoom: ZoomMode, ppd: number, label: (d: Date, zoom: ZoomMode) => string, weekStart = 1): Tick[] {
  const ticks: Tick[] = [];
  const gap = zoom === "Day" ? MIN_TICK_GAP : MIN_TICK_GAP_WIDE;
  for (let day = range.min; day <= range.max; day++) {
    const d = new Date(day * MS_PER_DAY);
    const x = (day - range.min) * ppd;
    const major = d.getUTCDate() === 1;
    if (!(zoom === "Day" || (zoom === "Week" && d.getUTCDay() === weekStart) || (zoom === "Month" && major))) continue;
    const text = label(d, zoom);
    const prev = ticks[ticks.length - 1];
    if (prev && x - prev.x < gap) {
      if (major && !prev.major) ticks[ticks.length - 1] = { x, label: text, major };
      continue;
    }
    ticks.push({ x, label: text, major });
  }
  return ticks;
}

// the band above the ticks: a heading at each month (Day/Week) or year (Month), plus one at the left edge for the current one
export function buildBands(range: DateRange, zoom: ZoomMode, ppd: number, label: (d: Date) => string): Tick[] {
  const out: Tick[] = [];
  for (let day = range.min; day <= range.max; day++) {
    const d = new Date(day * MS_PER_DAY);
    const start = d.getUTCDate() === 1 && (zoom !== "Month" || d.getUTCMonth() === 0);
    if (day === range.min || start) out.push({ x: (day - range.min) * ppd, label: label(d), major: start });
  }
  // drop the left-edge heading when a boundary follows right after it
  if (out.length > 1 && out[1].x - out[0].x < MIN_TICK_GAP_WIDE * 2) out.shift();
  return out;
}
