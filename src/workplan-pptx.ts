// draws a work plan (laid out by workplan.ts) as a PowerPoint deck: a 16:9 slide per page, right to left, Arial. Dark text on light tints
// with outlines a shade darker, so it reads in greyscale print as well as projected
import PptxGenJS from "pptxgenjs";
import { MARK, SLIDE, WP_TEXT, type Bar, type Box, type LegendKind, type Look, type Side, type WorkPlan } from "./workplan";

type Slide = PptxGenJS.Slide;
type Line = PptxGenJS.ShapeLineProps;

// Arial on one line (the layout picks the line breaks), in the direction of the text's first letter, as Obsidian shows it: a Hebrew name right
// to left, an English one left to right. With no letter at all (a page number) left to right, so PowerPoint keeps the digits in order
function font(text: string) {
  const rtl = /^[^\p{L}]*[֐-ࣿיִ-﷿ﹰ-﻿]/u.test(text);
  return { fontFace: "Arial", wrap: false, lang: rtl ? "he-IL" : "en-US", rtlMode: rtl };
}
const INK = "1F2937";
const MUTED = "6B7280";
const DARK = "334155"; // people, the Gregorian months, routine work
const PALE = "E2E8F0"; // the Hebrew months
const RISK = "DC2626";
const RISK_LINE: Line = { color: RISK, width: 1.5, dashType: "dash" }; // at risk: a dashed outline, whatever the fill
const GRID = "CBD5E1";
const WHITE = "FFFFFF";

// the colour `amount` of the way from `c` to `to` (#rrggbb), as PowerPoint wants it (RRGGBB)
function mix(c: string, to: string, amount: number): string {
  const ch = (h: string, i: number) => parseInt(h.slice(1 + 2 * i, 3 + 2 * i), 16);
  return [0, 1, 2].map((i) => Math.round(ch(c, i) + (ch(to, i) - ch(c, i)) * amount).toString(16).padStart(2, "0")).join("").toUpperCase();
}

// a box's fill, outline and text colour
function style(look: Look | LegendKind, color: string): { fill: string; line: Line; ink: string } {
  switch (look) {
    case "routine":
      return { fill: DARK, line: { color: "1E293B", width: 0.75 }, ink: WHITE };
    case "unavailable":
      return { fill: "F1F5F9", line: { color: "94A3B8", width: 0.75 }, ink: "475569" };
    case "done":
      return { fill: mix(color, "#ffffff", 0.9), line: { color: mix(color, "#ffffff", 0.45), width: 0.75 }, ink: MUTED };
    case "risk":
      return { fill: WHITE, line: RISK_LINE, ink: INK };
    default:
      return { fill: mix(color, "#ffffff", 0.78), line: { color: mix(color, "#000000", 0.3), width: 0.75 }, ink: INK };
  }
}

const at = (b: Box) => ({ x: b.x, y: b.y, w: b.w, h: b.h });
const radius = (b: Box) => Math.min(0.06, b.w / 2, b.h / 2);

// external dependency: a chain link, two rings centred at (x, y), 0.17 in across
function linkIcon(s: Slide, x: number, y: number, color: string): void {
  for (const d of [-1, 1]) {
    s.addShape("roundRect", { x: x + d * 0.03 - 0.055, y: y - d * 0.03 - 0.0275, w: 0.11, h: 0.055, rectRadius: 0.0275, rotate: 315, fill: { type: "none" }, line: { color, width: 1.25 } });
  }
}

// a clipped side: a triangle 0.08 × 0.12 in pointing out of the period, its tip at x
function clipArrow(s: Slide, x: number, y: number, right: boolean, color: string): void {
  // rotated a quarter turn, the shape's width and height swap on the slide
  s.addShape("triangle", { x: (right ? x - 0.04 : x + 0.04) - 0.06, y: y - 0.04, w: 0.12, h: 0.08, rotate: right ? 90 : 270, fill: { color }, line: { type: "none" } });
}

// a name beside its box or milestone, on the slide's white so today's line and the grid pass behind it as they do behind a box
function besideText(s: Slide, l: Side, muted: boolean): void {
  s.addText(l.text, { ...at(l), ...font(l.text), fill: { color: WHITE }, fontSize: l.size, color: muted ? MUTED : INK, align: l.align, valign: "middle", margin: 0 });
}

function drawBar(s: Slide, b: Bar): void {
  const st = style(b.look, b.color);
  s.addText(b.text, {
    ...at(b),
    ...font(b.text),
    shape: "roundRect",
    rectRadius: radius(b),
    fill: { color: st.fill },
    line: b.risk ? RISK_LINE : st.line,
    fontSize: b.size,
    color: st.ink,
    italic: b.look === "unavailable",
    align: "center",
    valign: "middle",
    margin: [b.padL * 72, b.padR * 72, 0, 0], // pt: left, right, bottom, top
  });
  const mid = b.y + b.h / 2;
  if (b.clipStart) clipArrow(s, b.x + b.w - 0.02, mid, true, st.ink);
  if (b.clipEnd) clipArrow(s, b.x + 0.02, mid, false, st.ink);
  // shortcut: a box too narrow for the icon goes without it (a day or two in a half-year plan)
  if (b.external && b.w >= MARK.icon + 2 * MARK.pad) linkIcon(s, b.x + b.w - MARK.pad - (b.clipStart ? MARK.clip : 0) - MARK.icon / 2, mid, st.ink);
  if (b.beside) besideText(s, b.beside, b.look === "done");
}

// the plan as a .pptx file's bytes; the caller saves them
export async function workPlanPptx(plan: WorkPlan): Promise<ArrayBuffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.rtlMode = true;
  pptx.title = `${plan.title.text} · ${plan.subtitle.text}`;
  plan.pages.forEach((page, i) => {
    const s = pptx.addSlide();
    s.addText(plan.title.text, { ...at(plan.title), ...font(plan.title.text), fontSize: plan.title.size, bold: true, color: INK, align: "right", valign: "top", margin: 0 });
    s.addText(plan.subtitle.text, { ...at(plan.subtitle), ...font(plan.subtitle.text), fontSize: plan.subtitle.size, color: MUTED, align: "right", valign: "top", margin: 0 });

    for (const e of plan.legend) {
      if (e.kind === "external") {
        linkIcon(s, e.x + e.w - MARK.icon / 2, e.y + e.h / 2, INK);
        s.addText(e.text, { ...at(e), w: e.w - MARK.icon, ...font(e.text), fontSize: e.size, color: INK, align: "right", valign: "middle", margin: 0 });
        continue;
      }
      const st = style(e.kind === "category" ? "plain" : e.kind, e.color);
      s.addText(e.text, { ...at(e), ...font(e.text), shape: "roundRect", rectRadius: radius(e), fill: { color: st.fill }, line: st.line, fontSize: e.size, color: st.ink, italic: e.kind === "unavailable", align: "center", valign: "middle", margin: 0 });
    }

    for (const m of plan.hebMonths) s.addText(m.text, { ...at(m), ...font(m.text), shape: "roundRect", rectRadius: radius(m), fill: { color: PALE }, fontSize: m.size, bold: true, color: "1E293B", align: "center", valign: "middle", margin: 0 });
    for (const m of plan.months) s.addText(m.text, { ...at(m), ...font(m.text), shape: "roundRect", rectRadius: radius(m), fill: { color: DARK }, fontSize: m.size, bold: true, color: WHITE, align: "center", valign: "middle", margin: 0 });
    const body = { y: plan.top - 0.04, h: page.bottom - plan.top + 0.04 };
    for (const x of plan.grid) s.addShape("line", { x, w: 0, ...body, line: { color: GRID, width: 0.75, dashType: "dash" } });
    // today runs behind the boxes, so it never crosses a name
    if (plan.today !== undefined) {
      s.addShape("line", { x: plan.today, w: 0, ...body, line: { color: RISK, width: 1.5 } });
      s.addText(WP_TEXT.today, { x: plan.today - 0.3, y: page.bottom + 0.03, w: 0.6, h: 0.2, ...font(WP_TEXT.today), fontSize: 9, bold: true, color: RISK, align: "center", valign: "top", margin: 0 });
    }

    page.rows.forEach((r, k) => {
      if (k) s.addShape("line", { x: r.x, y: r.y, w: r.w, h: 0, line: { color: GRID, width: 0.75, dashType: "dash" } });
      s.addText(r.label.text, { ...at(r.label), ...font(r.label.text), shape: "roundRect", rectRadius: radius(r.label), fill: { color: DARK }, fontSize: r.label.size, bold: true, color: WHITE, align: "center", valign: "middle", margin: 0 });
      for (const b of r.bars) drawBar(s, b);
      for (const m of r.milestones) {
        s.addShape("diamond", { ...at(m), fill: { color: m.done ? mix(m.color, "#ffffff", 0.45) : mix(m.color, "#000000", 0.3) }, line: m.risk ? RISK_LINE : { color: WHITE, width: 0.75 } });
        besideText(s, m.beside, m.done);
      }
    });
    if (plan.pages.length > 1) s.addText(`${i + 1}/${plan.pages.length}`, { x: 0.3, y: SLIDE.h - 0.45, w: 0.6, h: 0.2, ...font(""), fontSize: 9, color: MUTED, align: "left", valign: "bottom", margin: 0 });
  });
  return (await pptx.write({ outputType: "arraybuffer", compression: true })) as ArrayBuffer;
}
