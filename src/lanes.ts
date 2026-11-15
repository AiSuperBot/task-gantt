// ボード（ステータスの列）とチーム（人ごと）への振り分け。Obsidian に依存しない純粋な部分（画面は view.ts）
// the board (one column per status) and team (one card per person) layouts: the pure part (the screen is in view.ts)
import type { StatusDef, Task } from "./types";
import { anchorEnd, anchorStart } from "./model";
import { dayIndex } from "./timeline";
import { linkLabel } from "./links";

// 列：「(なし)」（null。ステータスの無いカードがあるときだけ）、設定のステータスの順、設定に無いステータス（ほかの端末で足したものなど）を名前順に
// columns: "(none)" (null, only when some card has no status), the settings' statuses in order, then statuses the settings lack
// (added on another computer, say) by name
export function boardColumns(tasks: Task[], statuses: StatusDef[]): (string | null)[] {
  const ids = statuses.map((s) => s.id);
  const unknown = [...new Set(tasks.map((t) => t.status).filter((s): s is string => !!s && !ids.includes(s)))].sort();
  return [...(tasks.some((t) => !t.status) ? [null] : []), ...ids, ...unknown];
}

// 人ごとのタスク（共有のタスクは各人に、担当なしは none に）。everyone はタスクが無くても出す人。並びは自分が先頭、none が最後、あとは名前順。
// tasks の並びは保つ / each person's tasks (a shared task under each, unassigned under `none`); `everyone` shows up even without tasks.
// Order: me first, `none` last, the rest by name; the tasks keep their given order
export function byPerson(tasks: Task[], everyone: string[], none: string, me?: string): [string, Task[]][] {
  const out = new Map<string, Task[]>(everyone.map((p) => [p, []]));
  for (const t of tasks) for (const p of t.assignees.length ? [...new Set(t.assignees.map(linkLabel))] : [none]) out.set(p, [...(out.get(p) ?? []), t]);
  const rank = (k: string) => (k === me ? 0 : k === none ? 2 : 1);
  return [...out].sort(([x], [y]) => rank(x) - rank(y) || x.localeCompare(y));
}

// スプリントのノート：#sprint か #sprint/… のタグ（大文字小文字は問わない）。日付がスプリントの期間で、名前にゴールを書く
// a sprint note: tagged #sprint or #sprint/… (any case); its dates are the sprint's and its name carries the goal
export function isSprint(t: Task): boolean {
  return t.tags.some((x) => /^sprint(\/|$)/i.test(x));
}

// ボードでのカードの時期。[from, to] はスプリントの期間（無ければ今日の前後 2 週間）：終わった仕事は終えた日（記録が無ければ期限）が from より前
// （か日付なし）なら older、残っている仕事は始まりが to より後なら later、ほかは now。どの端末でも同じになるよう、ノートの日付だけで決める
// when a card sits on the board. [from, to] is the sprint (else two weeks either side of today): finished work done (else due, when no day was
// recorded) before `from`, or undated, is "older"; open work starting after `to` is "later"; the rest "now". Only the notes' dates decide,
// so every computer agrees
export function boardWhen(t: Task, finished: boolean, from: number, to: number): "older" | "later" | "now" {
  if (finished) {
    const end = t.completed ?? anchorEnd(t);
    return !end || dayIndex(end) < from ? "older" : "now";
  }
  const start = anchorStart(t);
  return start && dayIndex(start) > to ? "later" : "now";
}
