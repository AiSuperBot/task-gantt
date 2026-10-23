// ポップオーバーと、色・アイコンのピッカー（ビューと設定画面で共有）
// popovers plus the colour and icon pickers, shared by the view and the settings tab
import { getIconIds, setIcon } from "obsidian";
import { PALETTE, toHex } from "./colors";
import { t as tr } from "./i18n";

// アイコンピッカーで検索前に並べる候補 / the icons offered before anything is typed into the icon search
const SUGGESTED_ICONS = [
  "folder", "user", "users", "briefcase", "rocket", "flag", "star", "target",
  "bug", "code", "palette", "megaphone", "book-open", "calendar", "lightbulb", "heart",
  "home", "building-2", "package", "shield", "wrench", "flask-conical", "globe", "zap",
];

// anchor の直下に開き、外側クリック/Esc で閉じる。中身は build が作り、close を受け取る。同じ cls の既存ポップオーバーは先に閉じる
// open under `anchor`, closed on outside click / Esc; `build` fills it and receives `close`. An open popover of the same cls closes first
export function openPopover(anchor: HTMLElement, cls: string, build: (menu: HTMLElement, close: () => void) => void): void {
  // anchor と同じウィンドウに出す（設定画面は別ウィンドウで開くことがあり、activeDocument が本体を指す場合がある）
  // open in the anchor's own window: settings can open in a popout, where activeDocument may still point at the main window
  const doc = anchor.ownerDocument;
  const win = doc.defaultView ?? window;
  doc.querySelectorAll(`.${cls}`).forEach((e) => e.remove());
  const menu = doc.body.createDiv({ cls: `ogantt-popover ${cls}` });
  const close = () => {
    menu.remove();
    doc.removeEventListener("pointerdown", onOutside, true);
    doc.removeEventListener("keydown", onKey, true);
  };
  const onOutside = (e: PointerEvent) => {
    const tg = e.target as Node;
    if (!menu.contains(tg) && !anchor.contains(tg)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
  };
  build(menu, close);
  // 中身を作ってから寸法を測って位置決め。anchor の下に置き、画面外に出るなら上へ反転する
  // measure after building, then place below the anchor, flipping above when it would overflow
  const r = anchor.getBoundingClientRect();
  let top = r.bottom + 4;
  if (top + menu.offsetHeight > win.innerHeight) top = Math.max(4, r.top - menu.offsetHeight - 4);
  menu.style.top = `${top}px`;
  menu.style.left = `${Math.max(8, Math.min(r.left, win.innerWidth - menu.offsetWidth - 8))}px`;
  doc.addEventListener("pointerdown", onOutside, true);
  doc.addEventListener("keydown", onKey, true);
}

// パレットの色見本＋カスタム（ネイティブの色選択＝色相から自由に選べる）を host に並べる
// lay the palette swatches into `host`, plus a custom swatch that opens the native picker (any hue)
export function paletteInto(host: HTMLElement, current: string, onPick: (color: string) => void): void {
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
}

// 色のピッカー（パレットのポップオーバー）/ colour picker: the palette in a popover
export function pickColor(anchor: HTMLElement, current: string, onPick: (color: string) => void): void {
  openPopover(anchor, "ogantt-palette", (menu, close) => paletteInto(menu, current, (c) => { close(); onPick(c); }));
}

// アイコンのピッカー：候補の一覧と、Obsidian の全アイコンからの検索 / icon picker: suggestions, plus a search over all of Obsidian's icons
export function pickIcon(anchor: HTMLElement, onPick: (icon: string) => void): void {
  openPopover(anchor, "ogantt-iconpick", (menu, close) => {
    const search = menu.createEl("input", { type: "search", attr: { placeholder: tr().searchIcons } });
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
    window.setTimeout(() => search.focus(), 0);
  });
}
