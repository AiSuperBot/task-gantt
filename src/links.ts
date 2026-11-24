// wikilink parsing: pure functions with no Obsidian dependency (unit-tested)

export interface Wikilink {
  linkpath: string; // the target, without #subpath or |alias
  subpath: string; // e.g. "#Heading" (empty when absent)
  alias?: string; // the display text after "|"
}

// parse a value that is exactly one wikilink
export function parseWikilink(v: string): Wikilink | null {
  const m = v.trim().match(/^\[\[([^[\]|#]*)(#[^[\]|]*)?(?:\|([^[\]]*))?\]\]$/);
  if (!m || !m[1].trim()) return null;
  const alias = m[3]?.trim();
  return { linkpath: m[1].trim(), subpath: m[2] ?? "", alias: alias || undefined };
}

// the name to show: a wikilink's alias (or its file name), anything else as-is
export function linkLabel(v: string): string {
  const w = parseWikilink(v);
  if (!w) return v;
  if (w.alias) return w.alias;
  const base = w.linkpath.split("/").pop() ?? w.linkpath;
  return base.replace(/\.md$/i, "");
}

// the link text handed to openLinkText (linkpath + subpath)
export function linkTarget(w: Wikilink): string {
  return w.linkpath + w.subpath;
}

// when the text before the caret ends inside an unfinished wikilink ("[[" with no "]]", newline or "|" after it),
// return where the "[[" starts and the query typed so far
export function wikilinkQuery(before: string): { start: number; query: string } | null {
  const open = before.lastIndexOf("[[");
  if (open < 0) return null;
  const query = before.slice(open + 2);
  if (/\]\]|[\n|[]/.test(query)) return null;
  return { start: open, query };
}

// a frontmatter value as text. An unquoted `key: [[x]]` parses as the YAML array [["x"]], so turn it back into a wikilink
export function fmText(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (isBareLink(v)) return `[[${v[0][0]}]]`;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v); // show unexpected shapes verbatim
}

// a multi-valued frontmatter value (e.g. assignees) as a string list: a single value or a list, each item read like fmText
export function fmList(v: unknown): string[] {
  const items = Array.isArray(v) && !isBareLink(v) ? v.map(fmText) : [fmText(v)];
  return [...new Set(items.map((x) => x?.trim()).filter((x): x is string => !!x))];
}

// whether YAML parsed an unquoted [[x]] into [["x"]]
export function isBareLink(v: unknown): v is [[string]] {
  return Array.isArray(v) && v.length === 1 && Array.isArray(v[0]) && v[0].length === 1 && typeof v[0][0] === "string";
}
