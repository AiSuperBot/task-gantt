// confirm dialog for destructive actions, shared by the view and the settings tab; it lives in its
// own module because importing it from view.ts would cycle back through main.ts into settings.ts
import { App, Component, FuzzySuggestModal, MarkdownRenderer, Modal, Notice } from "obsidian";
import { t as tr } from "./i18n";

export interface ConfirmOpts {
  title: string;
  body: string;
  sub?: string;
  confirmText: string;
  cancelText: string;
  onConfirm: () => void;
}
export class ConfirmModal extends Modal {
  constructor(app: App, private opts: ConfirmOpts) {
    super(app);
  }
  onOpen(): void {
    this.titleEl.setText(this.opts.title);
    this.contentEl.createEl("p", { text: this.opts.body });
    if (this.opts.sub) this.contentEl.createEl("p", { cls: "ogantt-confirm-sub", text: this.opts.sub });
    const btns = this.contentEl.createDiv({ cls: "ogantt-confirm-btns" });
    const cancel = btns.createEl("button", { text: this.opts.cancelText });
    cancel.onclick = () => this.close();
    const ok = btns.createEl("button", { cls: "mod-warning", text: this.opts.confirmText });
    ok.onclick = () => {
      this.close();
      this.opts.onConfirm();
    };
    window.setTimeout(() => ok.focus(), 0); // Enter confirms
  }
  onClose(): void {
    this.contentEl.empty();
  }
}

// a dialog that asks for one of several buttons; closing without choosing (Esc, ×, outside click) calls onDismiss
export interface ChoiceOpts {
  title: string;
  body: string;
  sub?: string;
  choices: { text: string; cta?: boolean; onPick: () => void }[];
  onDismiss: () => void;
}
export class ChoiceModal extends Modal {
  private picked = false;
  constructor(app: App, private opts: ChoiceOpts) {
    super(app);
  }
  onOpen(): void {
    this.titleEl.setText(this.opts.title);
    this.contentEl.createEl("p", { text: this.opts.body });
    if (this.opts.sub) this.contentEl.createEl("p", { cls: "ogantt-confirm-sub", text: this.opts.sub });
    const btns = this.contentEl.createDiv({ cls: "ogantt-confirm-btns" });
    for (const c of this.opts.choices) {
      const b = btns.createEl("button", { cls: c.cta ? "mod-cta" : "", text: c.text });
      b.onclick = () => {
        this.picked = true;
        this.close();
        c.onPick();
      };
      if (c.cta) window.setTimeout(() => b.focus(), 0); // Enter picks the main choice
    }
  }
  onClose(): void {
    this.contentEl.empty();
    if (!this.picked) this.opts.onDismiss();
  }
}

// the three health words a leader picks from, and the callout each opens the report with (its colour and icon)
export type Health = "onTrack" | "atRisk" | "offTrack";
export const HEALTH_LABEL = { onTrack: "healthOnTrack", atRisk: "healthAtRisk", offTrack: "healthOffTrack" } as const;
export const HEALTH_CALLOUT: Record<Health, string> = { onTrack: "success", atRisk: "warning", offTrack: "danger" };

// the status report: the health is picked by hand from three, each with its meaning shown (the tool never decides it), a headline says what
// to know first and any ask; the report built from the board shows beside them exactly as it will read, and is copied to paste into a note
// or a message. Clicking the picked health again clears it; with neither, the report holds only the board's part
export class ReportModal extends Modal {
  private shown: Component | null = null; // the preview's render, unloaded before the next one
  constructor(app: App, private build: (health: Health | "", headline: string) => string) {
    super(app);
  }
  onOpen(): void {
    const s = tr();
    this.modalEl.addClass("ogantt-report-modal");
    this.titleEl.setText(s.reportTitle);
    const grid = this.contentEl.createDiv({ cls: "ogantt-report" });
    const form = grid.createDiv({ cls: "ogantt-report-form" });
    const preview = grid.createDiv({ cls: "ogantt-report-preview markdown-rendered", attr: { "aria-live": "polite" } });
    let health: Health | "" = "";
    const render = () => {
      this.shown?.unload();
      this.shown = new Component();
      this.shown.load();
      preview.empty();
      void MarkdownRenderer.render(this.app, this.build(health, headline.value.trim()), preview, "", this.shown);
    };
    form.createDiv({ cls: "ogantt-report-label", text: s.reportHealth });
    const options = form.createDiv({ cls: "ogantt-report-health" });
    const words: [Health, string, string][] = [["onTrack", s.healthOnTrack, s.healthOnTrackDesc], ["atRisk", s.healthAtRisk, s.healthAtRiskDesc], ["offTrack", s.healthOffTrack, s.healthOffTrackDesc]];
    for (const [key, label, desc] of words) {
      const b = options.createEl("button", { cls: `ogantt-health is-${key}`, attr: { "aria-pressed": "false" } });
      b.createSpan({ cls: "ogantt-health-dot", attr: { "aria-hidden": "true" } });
      const text = b.createSpan({ cls: "ogantt-health-text" });
      text.createSpan({ cls: "ogantt-health-name", text: label });
      text.createSpan({ cls: "ogantt-health-desc", text: desc });
      b.onclick = () => {
        health = health === key ? "" : key;
        options.querySelectorAll(".ogantt-health").forEach((x, i) => x.setAttr("aria-pressed", String(words[i][0] === health)));
        render();
      };
    }
    form.createDiv({ cls: "ogantt-report-label", text: s.reportHeadline });
    form.createDiv({ cls: "ogantt-report-hint", text: s.reportHeadlineHint });
    const headline = form.createEl("textarea", { cls: "ogantt-report-headline", attr: { rows: "4", "aria-label": s.reportHeadline, dir: "auto" } });
    let typing = 0;
    headline.addEventListener("input", () => {
      window.clearTimeout(typing);
      typing = window.setTimeout(render, 150);
    });
    form.createEl("button", { cls: "mod-cta ogantt-report-copy", text: s.reportCopy }).onclick = async () => {
      try {
        // the window this modal is in: a board in its own window copies from there (the main window isn't the focused one then)
        await this.contentEl.win.navigator.clipboard.writeText(this.build(health, headline.value.trim()));
        new Notice(s.reportCopied);
        this.close();
      } catch (e) {
        new Notice(String(e)); // never fail silently
      }
    };
    render();
  }
  onClose(): void {
    this.shown?.unload();
    this.contentEl.empty();
  }
}

// a small picker over a fixed list (tags, tasks, folders), so names never have to be typed by hand; Obsidian's fuzzy search ranks
// the matches and highlights the matched letters ("dsgn rev" finds "Design review")
export class PickModal<T> extends FuzzySuggestModal<T> {
  constructor(app: App, private choices: T[], private label: (item: T) => string, placeholder: string, private onPick: (item: T) => void) {
    super(app);
    this.setPlaceholder(placeholder);
  }
  getItems(): T[] {
    return this.choices;
  }
  getItemText(item: T): string {
    return this.label(item);
  }
  onChooseItem(item: T): void {
    this.onPick(item);
  }
}
