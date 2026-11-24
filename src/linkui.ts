// wikilink UI helpers: the note-suggestion popup opened by typing "[[", and link click / hover wiring
import { App, Component, Keymap, TFile, prepareFuzzySearch } from "obsidian";
import { VIEW_TYPE_GANTT } from "./types";
import { linkLabel, linkTarget, parseWikilink, wikilinkQuery } from "./links";

const MAX_ITEMS = 20; // max suggestions shown

// add "[[" note suggestions to an input or textarea; while the popup is open it takes Enter, Esc and the arrows
export function attachLinkSuggest(app: App, el: HTMLInputElement | HTMLTextAreaElement, sourcePath: string): void {
  let pop: HTMLElement | null = null;
  let items: TFile[] = [];
  let sel = 0;
  let start = 0; // where the "[[" starts
  let listAttr: string | null = null; // detach any datalist while open

  const close = (): void => {
    pop?.remove();
    pop = null;
    if (listAttr != null) {
      el.setAttr("list", listAttr);
      listAttr = null;
    }
  };

  const candidates = (query: string): TFile[] => {
    const files = app.vault.getFiles();
    if (!query) return files.sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, MAX_ITEMS);
    const match = prepareFuzzySearch(query);
    const scored: [TFile, number][] = [];
    for (const f of files) {
      const r = match(f.extension === "md" ? f.path.slice(0, -3) : f.path);
      if (r) scored.push([f, r.score]);
    }
    return scored.sort((a, b) => b[1] - a[1]).slice(0, MAX_ITEMS).map(([f]) => f);
  };

  const paint = (): void => {
    if (!pop) return;
    pop.empty();
    items.forEach((f, i) => {
      const it = pop!.createDiv({ cls: "suggestion-item mod-complex" });
      if (i === sel) it.addClass("is-selected");
      const c = it.createDiv({ cls: "suggestion-content" });
      c.createDiv({ cls: "suggestion-title", text: f.extension === "md" ? f.basename : f.name });
      const dir = f.parent && !f.parent.isRoot() ? f.parent.path : "";
      if (dir) c.createDiv({ cls: "suggestion-note", text: dir });
      it.addEventListener("mousemove", () => {
        if (sel === i) return;
        sel = i;
        paint();
      });
      it.addEventListener("click", () => choose(f));
    });
    pop.children[sel]?.scrollIntoView({ block: "nearest" });
  };

  const place = (): void => {
    if (!pop) return;
    const r = el.getBoundingClientRect();
    const caret = el.instanceOf(HTMLTextAreaElement) ? caretOffset(el) : null; // instanceof fails in a pop-out window
    const top = caret ? r.top + caret.top : r.bottom;
    const left = caret ? r.left + caret.left : r.left;
    const win = activeWindow;
    const h = pop.offsetHeight;
    // flip above when it doesn't fit below
    const y = top + h > win.innerHeight - 8 ? Math.max(8, (caret ? r.top + caret.top - caret.line : r.top) - h) : top;
    const x = Math.min(left, win.innerWidth - pop.offsetWidth - 8);
    pop.setCssStyles({ top: `${y}px`, left: `${Math.max(8, x)}px` });
  };

  const update = (): void => {
    const caret = el.selectionStart ?? el.value.length;
    const q = wikilinkQuery(el.value.slice(0, caret));
    if (!q) return close();
    start = q.start;
    items = candidates(q.query);
    if (items.length === 0) return close();
    sel = 0;
    if (!pop) {
      pop = activeDocument.body.createDiv({ cls: "suggestion-container ogantt-link-suggest" });
      // keep focus in the field (no blur-save)
      pop.addEventListener("mousedown", (e) => e.preventDefault());
      if (el.hasAttribute("list")) {
        listAttr = el.getAttribute("list");
        el.removeAttribute("list");
      }
    }
    paint();
    place();
  };

  const choose = (f: TFile): void => {
    const caret = el.selectionStart ?? el.value.length;
    let rest = el.value.slice(caret);
    if (rest.startsWith("]]")) rest = rest.slice(2); // don't double an auto-closed "]]"
    const link = `[[${app.metadataCache.fileToLinktext(f, sourcePath, true)}]]`;
    el.value = el.value.slice(0, start) + link + rest;
    const pos = start + link.length;
    el.setSelectionRange(pos, pos);
    close();
    el.dispatchEvent(new Event("input")); // let listeners (autosize) react
  };

  el.addEventListener("input", update);
  el.addEventListener("blur", close);
  // run before the field's own Enter-saves / Esc-cancels
  el.addEventListener(
    "keydown",
    (e: KeyboardEvent) => {
      if (!pop || e.isComposing) return;
      let handled = true;
      if (e.key === "ArrowDown") sel = (sel + 1) % items.length;
      else if (e.key === "ArrowUp") sel = (sel - 1 + items.length) % items.length;
      else if (e.key === "Enter" || e.key === "Tab") { choose(items[sel]); return stop(e); }
      else if (e.key === "Escape") { close(); return stop(e); }
      else handled = false;
      if (handled) { paint(); stop(e); }
    },
    true
  );
}

function stop(e: KeyboardEvent): void {
  e.preventDefault();
  e.stopImmediatePropagation();
}

// measure the caret position inside a textarea (px from its top-left; `top` is the line's bottom) with a mirror div
function caretOffset(ta: HTMLTextAreaElement): { top: number; left: number; line: number } {
  const cs = activeWindow.getComputedStyle(ta);
  const m = activeDocument.body.createDiv();
  const props = [
    "boxSizing", "width", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
    "fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "lineHeight",
    "textTransform", "wordSpacing", "textIndent", "tabSize",
  ] as const;
  for (const p of props) m.style[p] = cs[p];
  m.setCssStyles({ position: "absolute", visibility: "hidden", whiteSpace: "pre-wrap", overflowWrap: "break-word", top: "0", left: "-9999px" });
  m.setText(ta.value.slice(0, ta.selectionStart ?? 0));
  const mark = m.createSpan({ text: "\u200B" });
  const line = mark.offsetHeight;
  const out = { top: mark.offsetTop + line - ta.scrollTop, left: mark.offsetLeft - ta.scrollLeft, line };
  m.remove();
  return out;
}

// open rendered internal links (a.internal-link) on click and show Page preview on hover.
// Returns true when the click landed on a link (the caller then skips entering edit mode)
export function handleLinkClick(app: App, e: MouseEvent, sourcePath: string): boolean {
  const a = (e.target as HTMLElement).closest("a");
  if (!a) return false;
  if (a.hasClass("internal-link")) {
    e.preventDefault();
    const href = a.getAttr("data-href") ?? a.getAttr("href") ?? "";
    void app.workspace.openLinkText(href, sourcePath, Keymap.isModEvent(e));
  }
  // external links, tags etc. keep their default behaviour
  return true;
}

// show Page preview when hovering an internal link (attach once per container)
export function wireLinkHover(app: App, container: HTMLElement, hoverParent: Component, sourcePath: string): void {
  container.addEventListener("mouseover", (e) => {
    const a = (e.target as HTMLElement).closest("a.internal-link");
    if (!a?.instanceOf(HTMLElement)) return; // in a pop-out window too
    app.workspace.trigger("hover-link", {
      event: e,
      source: VIEW_TYPE_GANTT,
      hoverParent,
      targetEl: a,
      linktext: a.getAttr("data-href") ?? a.getAttr("href") ?? "",
      sourcePath,
    });
  });
}

// render a value: a clickable internal link for a wikilink, plain text otherwise
export function renderLinkValue(parent: HTMLElement, v: string, textCls: string): HTMLElement {
  const w = parseWikilink(v);
  if (!w) return parent.createSpan({ cls: textCls, text: v });
  const a = parent.createEl("a", { cls: `internal-link ${textCls}`, text: linkLabel(v) });
  a.setAttr("data-href", linkTarget(w));
  a.setAttr("href", linkTarget(w));
  return a;
}
