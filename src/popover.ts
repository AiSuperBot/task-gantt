// popovers plus the colour and icon pickers, shared by the view and the settings tab
import { App, Scope, getIconIds, setIcon } from "obsidian";
import { PALETTE, toHex } from "./colors";
import { t as tr } from "./i18n";

// the icons offered before anything is typed into the icon search
const SUGGESTED_ICONS = [
  "folder", "user", "users", "briefcase", "rocket", "flag", "star", "target",
  "bug", "code", "palette", "megaphone", "book-open", "calendar", "lightbulb", "heart",
  "home", "building-2", "package", "shield", "wrench", "flask-conical", "globe", "zap",
];

// Obsidian's key handling (so a popover gets Esc before, say, the settings window behind it); handed over when the plugin loads
let keys: App | null = null;
export function usePopoverKeys(app: App): void {
  keys = app;
}

// open popovers and how to close each; removing one always goes through its close, so its Esc binding is always released
const openOnes = new Map<HTMLElement, () => void>();
export function closePopovers(doc: Document, cls = "ogantt-popover"): void {
  for (const [el, close] of [...openOnes]) if (el.ownerDocument === doc && el.classList.contains(cls)) close();
}

// what can take focus inside a popover
const FOCUSABLE = "input, select, textarea, button, [tabindex='0']";
// a key pressed while an input method is composing (not meant for us)
const composing = (e: KeyboardEvent): boolean => e.isComposing || e.keyCode === 229;

// open under `anchor`, closed on outside click / Esc; `build` fills it and receives `close`. An open popover of the same cls closes first
export function openPopover(anchor: HTMLElement, cls: string, build: (menu: HTMLElement, close: () => void) => void): void {
  // open in the anchor's own window: settings can open in a popout, where activeDocument may still point at the main window
  const doc = anchor.ownerDocument;
  const win = doc.defaultView ?? window;
  closePopovers(doc, cls);
  const menu = doc.body.createDiv({ cls: `ogantt-popover ${cls}` });
  // while open, Esc is taken at the top of Obsidian's key handling (nothing behind closes)
  const scope = keys ? new Scope(keys.scope) : null;
  scope?.register([], "Escape", (e) => {
    // Esc that cancels a conversion, or closes open "[[" suggestions, goes to those
    if (composing(e) || doc.querySelector(".ogantt-link-suggest")) return true;
    close();
    return false;
  });
  if (scope) keys!.keymap.pushScope(scope);
  let closed = false;
  const before = doc.activeElement as HTMLElement | null; // focus returns here on close
  // where a replacement is looked for: only inside the view (or settings window) it was opened from
  const home: ParentNode = before?.closest(".workspace-leaf-content, .modal-container") ?? doc;
  // when the element that opened it was redrawn away, focus goes to its replacement (same data-focus, else the same tag, classes and text)
  const twin = (el: HTMLElement): HTMLElement | null => {
    if (el.isConnected) return el;
    const key = el.dataset.focus;
    if (key) return home.querySelector<HTMLElement>(`[data-focus="${CSS.escape(key)}"]`);
    return Array.from(home.querySelectorAll<HTMLElement>(el.tagName)).find((x) => x.className === el.className && x.textContent === el.textContent) ?? null;
  };
  const close = () => {
    if (closed) return;
    closed = true;
    openOnes.delete(menu);
    if (scope) keys!.keymap.popScope(scope);
    // return focus even when a rebuild inside dropped it to the body
    const inside = menu.contains(doc.activeElement) || doc.activeElement === doc.body;
    menu.remove();
    doc.removeEventListener("pointerdown", onOutside, true);
    win.removeEventListener("keydown", onKey, true);
    win.removeEventListener("unload", close);
    if (inside && before) twin(before)?.focus();
  };
  const onOutside = (e: PointerEvent) => {
    const tg = e.target as HTMLElement;
    // pressing a menu or a "[[" suggestion opened from inside isn't outside
    if (!menu.contains(tg) && !anchor.contains(tg) && !tg.closest?.(".menu, .ogantt-link-suggest")) close();
  };
  // Tab cycles inside the popover so keyboard focus can't wander off behind it. Esc is handled only by the Scope above (with popovers stacked,
  // only the top one closes). Keys during a conversion, or while "[[" suggestions are open, go to those
  const onKey = (e: KeyboardEvent) => {
    if (composing(e) || doc.querySelector(".ogantt-link-suggest")) return;
    if (e.key !== "Tab" || !menu.contains(doc.activeElement)) return;
    const items = focusable();
    const edge = e.shiftKey ? items[0] : items[items.length - 1];
    if (doc.activeElement === edge) {
      e.preventDefault();
      (e.shiftKey ? items[items.length - 1] : items[0])?.focus();
    }
  };
  openOnes.set(menu, close);
  build(menu, close);
  const focusable = () => Array.from(menu.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.matches(":disabled"));
  // measure after building, then place below the anchor, flipping above when it would overflow
  const r = anchor.getBoundingClientRect();
  let top = r.bottom + 4;
  if (top + menu.offsetHeight > win.innerHeight) top = Math.max(4, r.top - menu.offsetHeight - 4);
  menu.style.top = `${top}px`;
  // whatever doesn't fit the window scrolls, so short screens still reach the last items
  menu.style.maxHeight = `${win.innerHeight - top - 4}px`;
  menu.style.left = `${Math.max(8, Math.min(r.left, win.innerWidth - menu.offsetWidth - 8))}px`;
  doc.addEventListener("pointerdown", onOutside, true);
  win.addEventListener("keydown", onKey, true);
  // release the key binding even when the whole window closes (the settings window, …)
  win.addEventListener("unload", close, { once: true });
  // unless the content already took focus, it goes to an input when there is one (on a delete button, a typed space would press it), else the first control
  if (!menu.contains(doc.activeElement)) (focusable().find((el) => el.matches("input, select, textarea")) ?? focusable()[0])?.focus();
}

// lay the palette swatches into `host`, plus a custom swatch that opens the native picker (any hue); with `reset`, a back-to-automatic button too
export function paletteInto(host: HTMLElement, current: string, onPick: (color: string) => void, reset?: () => void): void {
  const grid = host.createDiv({ cls: "ogantt-palette-grid" });
  const cur = toHex(current).toLowerCase();
  for (const c of PALETTE) {
    const sw = grid.createEl("button", { cls: "ogantt-swatch", attr: { "aria-label": c } });
    sw.style.background = c;
    sw.toggleClass("is-active", c === cur);
    sw.onclick = () => onPick(c);
  }
  const custom = grid.createEl("input", { type: "color", cls: "ogantt-swatch ogantt-swatch-custom", attr: { "aria-label": tr().customColor } });
  custom.value = cur;
  custom.onchange = () => onPick(custom.value);
  if (!reset) return;
  const back = grid.createEl("button", { cls: "clickable-icon ogantt-swatch-reset", attr: { "aria-label": tr().menuResetColor } });
  setIcon(back, "rotate-ccw");
  back.onclick = reset;
}

// colour picker: the palette in a popover; `reset` adds a back-to-automatic button
export function pickColor(anchor: HTMLElement, current: string, onPick: (color: string) => void, reset?: () => void): void {
  openPopover(anchor, "ogantt-palette", (menu, close) => paletteInto(menu, current, (c) => { close(); onPick(c); }, reset && (() => { close(); reset(); })));
}

// icon picker: suggestions, plus a search over all of Obsidian's icons
export function pickIcon(anchor: HTMLElement, onPick: (icon: string) => void): void {
  openPopover(anchor, "ogantt-iconpick", (menu, close) => {
    const search = menu.createEl("input", { type: "search", attr: { placeholder: tr().searchIcons, "aria-label": tr().searchIcons } });
    const grid = menu.createDiv({ cls: "ogantt-iconpick-grid" });
    const all = getIconIds().map((id) => id.replace(/^lucide-/, ""));
    const paint = () => {
      grid.empty();
      const q = search.value.trim().toLowerCase();
      for (const id of (q ? all.filter((x) => x.includes(q)) : SUGGESTED_ICONS).slice(0, 80)) {
        const b = grid.createEl("button", { cls: "clickable-icon", attr: { "aria-label": id } });
        setIcon(b, id);
        b.onclick = () => { close(); onPick(id); };
      }
    };
    search.oninput = paint;
    paint();
  });
}
