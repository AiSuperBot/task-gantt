// ボード（ステータスの列）とチーム（人ごと）への振り分け。Obsidian に依存しない純粋な部分（画面は view.ts）
// the board (one column per status) and team (one card per person) layouts: the pure part (the screen is in view.ts)
import type { StatusDef, Task } from "./types";
import { anchorEnd, anchorStart } from "./model";
import { dayIndex } from "./timeline";

// 列：「(なし)」（null。ステータスの無いカードがあるときだけ）、設定のステータスの順、設定に無いステータス（ほかの端末で足したものなど）を名前順に
// columns: "(none)" (null, only when some card has no status), the settings' statuses in order, then statuses the settings lack
// (added on another computer, say) by name
export function boardColumns(tasks: Task[], statuses: StatusDef[]): (string | null)[] {
  const ids = statuses.map((s) => s.id);
  const unknown = [...new Set(tasks.map((t) => t.status).filter((s): s is string => !!s && !ids.includes(s)))].sort();
  return [...(tasks.some((t) => !t.status) ? [null] : []), ...ids, ...unknown];
}

export interface BoardLane {
  key: string; // レーンの値（人の表示名など）/ the lane's value (a person's display name, …)
  cells: Task[][]; // 列ごとのカード（columns と同じ並び）/ the cards per column, in the columns' order
}

// カードをレーンと列に分ける。tasks は並べ替え済みで、その順を保つ。レーンの並びは first（自分）が先頭、last（なし）が最後、あとは名前順
// split cards into lanes and columns; `tasks` come sorted and keep that order. Lanes: `first` (me) first, `last` (none) last, the rest by name
export function boardLanes(tasks: Task[], columns: (string | null)[], laneOf: (t: Task) => string, first?: string, last?: string): BoardLane[] {
  const byLane = new Map<string, Task[][]>();
  for (const t of tasks) {
    const key = laneOf(t);
    const cells = byLane.get(key) ?? columns.map(() => []);
    byLane.set(key, cells);
    const i = t.status ? columns.indexOf(t.status) : -1;
    cells[i >= 0 ? i : Math.max(0, columns.indexOf(null))].push(t);
  }
  const rank = (k: string) => (k === first ? 0 : k === last ? 2 : 1);
  return [...byLane.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).map((key) => ({ key, cells: byLane.get(key)! }));
}

// スプリントのノート：#sprint か #sprint/… のタグ（大文字小文字は問わない）。日付がスプリントの期間で、名前にゴールを書く
// a sprint note: tagged #sprint or #sprint/… (any case); its dates are the sprint's and its name carries the goal
export function isSprint(t: Task): boolean {
  return t.tags.some((x) => /^sprint(\/|$)/i.test(x));
}

// ボードでのカードの時期：終わった仕事は終えた日（記録が無ければ期限）が days 日より前（か日付なし）なら older、残っている仕事は始まりが
// days 日より先なら later、ほかは now。どの端末でも同じになるよう、ノートの日付だけで決める（ファイルの更新日時は同期で届いた時刻なので使わない）
// when a card sits on the board: finished work done (else due, when no day was recorded) more than `days` ago, or undated, is "older"; open
// work starting more than `days` ahead is "later"; the rest "now". Only the note's dates decide, so every computer agrees (a file's
// modified time is when sync delivered it)
export function boardWhen(t: Task, finished: boolean, today: number, days: number): "older" | "later" | "now" {
  if (finished) {
    const end = t.completed ?? anchorEnd(t);
    return !end || dayIndex(end) < today - days ? "older" : "now";
  }
  const start = anchorStart(t);
  return start && dayIndex(start) > today + days ? "later" : "now";
}
