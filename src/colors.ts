// 名前から色を決める共通処理。ビュー（タグ/フォルダ/担当者のバー色）と
// 設定画面（タグ色の取り込み）の両方が使うため、循環参照の起きない独立モジュールに置く。
// shared name → color helpers, used by the view (tag/folder/assignee bar colors) and by
// settings (importing tag colors); kept in its own module so neither side forms an import cycle.

// 色のパレット（ライト/ダークどちらのテーマでも見分けやすい 17 色。既定のステータス色と稲妻線の色を含む）
// the colour palette: 17 hues that stay distinct on light and dark themes, including the default status and progress-line colours
export const PALETTE = [
  "#ef4444", "#f97316", "#f59e0b", "#84cc16", "#22c55e", "#10b981", "#14b8a6", "#06b6d4", "#0ea5e9",
  "#3b82f6", "#6366f1", "#8b5cf6", "#a855f7", "#d946ef", "#ec4899", "#9aa0a6", "#64748b",
];

// HSL → #rrggbb（カラーピッカーの初期値に hex が要るため）/ HSL → hex (color inputs need hex)
export function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const c = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * c).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// 名前のハッシュ（0〜359）/ a name's hash (0-359)
function hash(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

// 名前から安定した色を生成（タグ/フォルダ共通・同じ名前は常に同じ色）/ deterministic color from any name
export function hashColor(name: string): string {
  return hslToHex(hash(name), 55, 55);
}

// 担当者の自動色：色相も明るさも離れた 10 色（隣どうしは特に違う色）/ automatic assignee colours: 10 set apart in hue and lightness (neighbours most of all)
const PEOPLE = ["#3b82f6", "#f97316", "#10b981", "#ec4899", "#eab308", "#8b5cf6", "#84cc16", "#ef4444", "#06b6d4", "#d946ef"];

// 名前ごとに、ハッシュで選んだ色か、使用済みなら次の空いている色。taken（手で選んだ色）は使わない。10 人までは同じ色にならず、
// 同じ顔ぶれなら毎回同じ色（並びは文字コード順なので、端末の言語設定でも変わらない）
// per name, its hashed colour or the next free one, never one in `taken` (colours picked by hand): up to 10 names never share a colour,
// and the same set of names always gets the same colours (they're taken in code-unit order, so the device's language can't change them)
export function distinctColors(names: string[], taken: string[] = []): Map<string, string> {
  const used = new Set(PEOPLE.flatMap((c, k) => (taken.some((t) => t.toLowerCase() === c) ? [k] : [])));
  const out = new Map<string, string>();
  for (const name of [...new Set(names)].sort()) {
    let k = hash(name) % PEOPLE.length;
    for (let n = 0; n < PEOPLE.length && used.has(k); n++) k = (k + 1) % PEOPLE.length;
    used.add(k);
    out.set(name, PEOPLE[k]);
  }
  return out;
}

// Obsidian 本体のタグ色（テーマ追従）。テーマが変数を定義していない場合は既定の紫にフォールバック
// Obsidian's own tag color, following the theme; falls back to its default purple if a theme omits it
const OBSIDIAN_TAG_FALLBACK = "#8b6cef";
export function obsidianTagColor(): string {
  const v = getComputedStyle(document.body).getPropertyValue("--tag-color").trim();
  return v || OBSIDIAN_TAG_FALLBACK;
}

// CSS の色表現を #rrggbb へ寄せる（input[type=color] は hex しか受け付けないため）
// coerce a CSS color into #rrggbb (input[type=color] only accepts hex)
export function toHex(css: string): string {
  const v = css.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  if (/^#[0-9a-f]{3}$/i.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  const m = v.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);
  if (m) return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
  return OBSIDIAN_TAG_FALLBACK; // hsl() など変換できない表現 / expressions we can't convert, e.g. hsl()
}

// その色の上に載せる文字色（黒か白のうちコントラストの高い方。WCAG の相対輝度で比べる）
// the text colour to put on a fill: black or white, whichever contrasts more (WCAG relative luminance)
export function inkOn(fill: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(toHex(fill).slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return (lum + 0.05) / 0.05 > 1.05 / (lum + 0.05) ? "#000" : "#fff";
}

// タグの実効色を決める。優先順位は 個別の色 > タグの既定色 > Obsidian 本体のタグ色。
// 一覧に名前だけ残して色を空にした行は「既定色に従う」を意味する。
// resolve a tag's effective color: per-tag override > configured default > Obsidian's own tag color.
// An entry kept in the list with an empty color means "follow the default".
export function resolveTagColor(overrides: { name: string; color: string }[], defaultColor: string, tag: string): string {
  return overrides.find((c) => c.name === tag)?.color || defaultColor || obsidianTagColor();
}
