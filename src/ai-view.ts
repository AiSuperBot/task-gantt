// The plan assistant's panel (right sidebar): a chat with the team's own AI server about the board used last. Answers come back as
// Markdown; changes come back as a proposal card that writes nothing until Apply, which is one undoable step on the board.
import { ItemView, MarkdownRenderer, Platform, setIcon, WorkspaceLeaf } from "obsidian";
import type GanttPlugin from "./main";
import type { GanttView } from "./view";
import { cosine, Edit, Fields, isHebrew, readEmbeddings, readReply, requestNote, runTool, safeLink, safeMarkdown, systemPrompt, ToolCall } from "./ai";
import { aiCall, chatRequest } from "./ai-client";
import { t as tr } from "./i18n";
import { formatDate } from "./timeline";

export const VIEW_TYPE_AI = "task-gantt-ai";
const ROUNDS = 6; // lookups per question before giving up (small models can loop)

type Msg = { role: "system" | "user" | "assistant" | "tool"; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string };

export class AiView extends ItemView {
  private chat: Msg[] = []; // the conversation sent with each question (the system prompt is added fresh every time)
  private busy = false;
  private log!: HTMLElement;
  private input!: HTMLTextAreaElement;
  private waits: HTMLButtonElement[] = []; // New chat and Send: off while an answer is on its way (it would land in the new chat)

  constructor(leaf: WorkspaceLeaf, private plugin: GanttPlugin) {
    super(leaf);
  }
  getViewType(): string {
    return VIEW_TYPE_AI;
  }
  getDisplayText(): string {
    return tr().aiTitle;
  }
  getIcon(): string {
    return "sparkles";
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("ogantt-ai");
    const head = root.createDiv({ cls: "ogantt-ai-head" });
    head.createDiv({ cls: "ogantt-ai-title", text: tr().aiTitle });
    const fresh = head.createEl("button", { cls: "clickable-icon", attr: { "aria-label": tr().aiNew } });
    setIcon(fresh, "square-pen");
    fresh.onclick = () => {
      this.chat = [];
      this.drawEmpty();
    };
    this.log = root.createDiv({ cls: "ogantt-ai-log", attr: { "aria-live": "polite" } });
    const composer = root.createDiv({ cls: "ogantt-ai-composer" });
    this.input = composer.createEl("textarea", { attr: { rows: "3", placeholder: tr().aiPlaceholder, "aria-label": tr().aiPlaceholder, dir: "auto" } });
    const send = composer.createEl("button", { cls: "mod-cta", attr: { "aria-label": tr().aiSend } });
    setIcon(send, "arrow-up");
    send.onclick = () => this.ask();
    this.waits = [fresh, send];
    // Enter sends, Shift+Enter breaks the line; never while an input method is composing (Enter confirms its conversion), and not on
    // a phone, whose keyboard has no Shift+Enter: there Enter breaks the line and the button sends
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229 && !Platform.isMobile) {
        e.preventDefault();
        this.ask();
      }
    });
    this.drawEmpty();
  }

  // the empty chat: what to set up, or questions to start from
  private drawEmpty(): void {
    this.log.empty();
    const box = this.log.createDiv({ cls: "ogantt-ai-empty" });
    const { url, model } = this.plugin.settings.ai;
    if (!url || !model) {
      box.createDiv({ text: tr().aiSetup });
      box.createEl("button", { text: tr().aiOpenSettings }).onclick = () => {
        const s = (this.app as unknown as { setting?: { open(): void; openTabById(id: string): void } }).setting;
        s?.open();
        s?.openTabById(this.plugin.manifest.id);
      };
      return;
    }
    const board = this.plugin.lastBoard();
    box.createDiv({ cls: "ogantt-ai-about", text: board ? tr().aiAbout(board.aiBoard().folder || "vault") : tr().aiNoBoard });
    for (const q of tr().aiSuggestions) {
      box.createEl("button", { cls: "ogantt-ai-suggestion", text: q }).onclick = () => {
        this.input.value = q;
        this.ask();
      };
    }
  }

  private ask(): void {
    const text = this.input.value.trim();
    if (!text || this.busy) return;
    this.input.value = "";
    void this.converse(text);
  }

  // one question: send it with the tools, run the lookups the model asks for, show the answer and any proposal
  private async converse(text: string): Promise<void> {
    const board = this.plugin.lastBoard();
    const { url, model } = this.plugin.settings.ai;
    this.log.querySelector(".ogantt-ai-empty")?.remove(); // the starting questions go; what was said so far stays
    this.bubble("user", text);
    if (!board || !url || !model) return this.note(board ? tr().aiSetup : tr().aiNoBoard);
    // what the plugin read in the request goes with it, and stays in the conversation (the next request then starts the same way)
    const note = requestNote(text, board.aiBoard());
    const mark = this.chat.length; // a turn that fails is taken back, so the next question isn't sent along with it
    this.chat.push({ role: "user", content: note ? `${text}\n\n${note}` : text });
    this.setBusy(true);
    let proposed = false;
    const wait = this.log.createDiv({ cls: "ogantt-ai-thinking", text: tr().aiThinking });
    try {
      for (let round = 0; round < ROUNDS; round++) {
        await board.fresh(); // a board whose tab is hidden hasn't followed the notes
        const b = { ...board.aiBoard(), hebrew: isHebrew(text), similar: this.plugin.settings.ai.embedModel ? this.similar : undefined };
        const system: Msg = { role: "system", content: systemPrompt(b, this.plugin.settings.ai.instructions) };
        const reply = await this.post([system, ...this.chat]);
        this.chat.push(reply);
        if (!reply.tool_calls?.length) {
          wait.remove();
          if (reply.content?.replace(/<think>[\s\S]*?<\/think>/g, "").trim()) return void (await this.bubble("assistant", reply.content));
          if (proposed) return; // the card is the answer
          this.chat.length = mark;
          return this.note(tr().aiNoAnswer);
        }
        for (const [k, call] of reply.tool_calls.entries()) {
          call.id ??= `call_${round}_${k}`; // some servers leave ids out; the answer must name the call it answers
          // every call gets its answer, an error included: a call left unanswered makes a server refuse the rest of the chat
          const out = await runTool(call.function.name, call.function.arguments, b).catch((e: unknown) => ({ content: `Error: ${e instanceof Error ? e.message : String(e)}`, proposal: undefined }));
          const answer: Msg = { role: "tool", tool_call_id: call.id, content: out.content };
          this.chat.push(answer);
          if (out.proposal) {
            proposed = true;
            this.proposal(out.proposal, answer, board);
            this.log.append(wait); // still working: the indicator stays last, below the card
          }
        }
      }
      this.note(tr().aiTooLong);
    } catch (e) {
      this.chat.length = mark;
      this.note(e instanceof Error ? e.message : String(e));
    } finally {
      wait.remove();
      this.setBusy(false);
    }
  }

  private setBusy(on: boolean): void {
    this.busy = on;
    for (const b of this.waits) b.disabled = on;
  }

  // one chat call, as set in Settings (endpoint, headers, extra fields, time limit); errors come back in words
  private async post(messages: Msg[]): Promise<Msg> {
    let reply;
    try {
      reply = readReply(await aiCall(this.plugin, this.plugin.settings.ai.chatPath, chatRequest(this.plugin, messages)));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(/tool/i.test(msg) && /support/i.test(msg) ? tr().aiNoTools : msg === tr().aiTimeout ? msg : tr().aiError(msg));
    }
    if (!reply) throw new Error(tr().aiError(tr().aiEmpty));
    return { role: "assistant", content: reply.content, tool_calls: reply.tool_calls };
  }

  // how close each text is to the query in meaning, from the embeddings set in Settings; each text's vector is kept for the session,
  // so a board's task names are sent once
  private vectors = new Map<string, number[]>();
  private similar = async (query: string, texts: string[]): Promise<number[] | null> => {
    const { url, embedModel, embedPath } = this.plugin.settings.ai;
    const key = (s: string) => `${url}\n${embedModel}\n${s}`;
    const missing = [...new Set([query, ...texts])].filter((s) => !this.vectors.has(key(s)));
    if (missing.length) {
      const got = readEmbeddings(await aiCall(this.plugin, embedPath, { model: embedModel, input: missing }));
      if (!got || got.length !== missing.length) return null;
      missing.forEach((s, i) => this.vectors.set(key(s), got[i]));
    }
    const q = this.vectors.get(key(query))!;
    return texts.map((s) => cosine(q, this.vectors.get(key(s))!));
  };

  // a message bubble; the assistant's in rendered Markdown, without any visible reasoning some models emit
  private async bubble(who: "user" | "assistant", text: string): Promise<void> {
    const el = this.log.createDiv({ cls: `ogantt-ai-msg is-${who}`, attr: { dir: "auto" } });
    if (who === "user") el.setText(text);
    else {
      await MarkdownRenderer.render(this.app, safeMarkdown(text.replace(/<think>[\s\S]*?<\/think>/g, "").trim()), el, "", this);
      // what can still be clicked is a web address written out in full; a tag, or an address with another scheme, becomes its text
      for (const a of Array.from(el.querySelectorAll("a"))) if (!safeLink(a.getAttribute("href") ?? "")) a.replaceWith(a.textContent ?? "");
    }
    this.log.scrollTop = this.log.scrollHeight;
  }

  private note(text: string): void {
    this.log.createDiv({ cls: "ogantt-ai-note", text });
    this.log.scrollTop = this.log.scrollHeight;
  }

  // a proposal: each task's changes (before → after), the dependent tasks it moves, and Apply / Discard. The model is told the outcome
  // of what happened to it. It belongs to the board it was worked out on, whichever board is in front when Apply is pressed
  private proposal(edits: Edit[], answer: Msg, board: GanttView): void {
    const s = this.plugin.settings;
    const card = this.log.createDiv({ cls: "ogantt-ai-proposal" });
    card.createDiv({ cls: "ogantt-ai-proposal-title", text: tr().aiProposal });
    const label: Record<keyof Fields, string> = { start: tr().fieldStart, end: tr().fieldDue, status: tr().fieldStatus, assignees: tr().fieldAssignee, blocker: tr().aiWaitingFor };
    const show = (k: keyof Fields, v: Fields[keyof Fields]): string => {
      if (v == null || v === "" || (Array.isArray(v) && !v.length)) return "—";
      if (k === "start" || k === "end") return formatDate(v as string, s.dateFormat);
      if (k === "status") return s.statuses.find((x) => x.id === v)?.label ?? String(v);
      return Array.isArray(v) ? v.join(", ") : String(v);
    };
    for (const e of edits) {
      const item = card.createDiv({ cls: "ogantt-ai-edit" + (e.cascaded ? " is-cascaded" : "") });
      const name = item.createDiv({ cls: "ogantt-ai-edit-name" });
      name.createSpan({ text: e.name, attr: { dir: "auto" } });
      if (e.cascaded) name.createSpan({ cls: "ogantt-ai-edit-note", text: tr().aiFollows });
      for (const k of Object.keys(e.after) as (keyof Fields)[]) {
        const line = item.createDiv({ cls: "ogantt-ai-change" });
        line.createSpan({ cls: "ogantt-ai-field", text: label[k] });
        line.createSpan({ cls: "ogantt-ai-before", text: show(k, e.before[k]), attr: { dir: "auto" } });
        line.createSpan({ cls: "ogantt-ai-arrow", text: "→", attr: { "aria-hidden": "true" } });
        line.createSpan({ cls: "ogantt-ai-after", text: show(k, e.after[k]), attr: { dir: "auto" } });
      }
    }
    const actions = card.createDiv({ cls: "ogantt-ai-actions" });
    const settle = (text: string, note: string) => {
      actions.empty();
      actions.createSpan({ cls: "ogantt-ai-outcome", text });
      answer.content += `\n${note}`;
    };
    const apply = actions.createEl("button", { cls: "mod-cta", text: tr().aiApply });
    const discard = actions.createEl("button", { text: tr().aiDiscard });
    apply.onclick = async () => {
      apply.disabled = discard.disabled = true; // one press, one write
      const how = await board.applyProposal(edits).catch(() => "failed" as const);
      if (how === "ok") return settle(tr().aiApplied(edits.length), "The user applied these changes.");
      // nothing was written, and this proposal can't be applied any more: say why, and let the model know too
      const why = { closed: "the board was closed", changed: "a task changed in the meantime. Look the tasks up again before proposing", failed: "the write failed" }[how];
      settle({ closed: tr().aiBoardClosed, changed: tr().aiBoardChanged, failed: tr().aiNotApplied }[how], `These changes were not applied: ${why}.`);
    };
    discard.onclick = () => settle(tr().aiDiscarded, "The user discarded these changes.");
    this.log.scrollTop = this.log.scrollHeight;
  }
}
