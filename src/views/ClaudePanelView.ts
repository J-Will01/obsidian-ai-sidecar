import { ItemView, Modal, Notice, WorkspaceLeaf } from "obsidian";
import { AgentOrchestrator } from "../agent/AgentOrchestrator";
import { ThreadIndexEntry, Thread } from "../state/types";

export const CLAUDE_PANEL_VIEW_TYPE = "claude-panel-view";

class BatchApplyModal extends Modal {
  private paths: string[];
  private onDecision: (approved: boolean) => void;
  private decided = false;

  constructor(leaf: WorkspaceLeaf, paths: string[], onDecision: (approved: boolean) => void) {
    super(leaf.app);
    this.paths = [...new Set(paths)];
    this.onDecision = onDecision;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("claude-confirm-modal");

    contentEl.createEl("h3", { text: "Confirm file writes" });
    contentEl.createDiv({
      text: `Apply ${this.paths.length} proposed change(s) to the following path(s):`
    });

    const list = contentEl.createEl("ul");
    for (const path of this.paths) {
      list.createEl("li", { text: path });
    }

    const actions = contentEl.createDiv({ cls: "claude-actions" });
    const cancel = actions.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => {
      this.decided = true;
      this.onDecision(false);
      this.close();
    });

    const apply = actions.createEl("button", { text: "Apply" });
    apply.addClass("mod-cta");
    apply.addEventListener("click", () => {
      this.decided = true;
      this.onDecision(true);
      this.close();
    });
  }

  onClose(): void {
    if (!this.decided) {
      this.onDecision(false);
    }
  }
}

export class ClaudePanelView extends ItemView {
  private orchestrator: AgentOrchestrator;
  private threadIndex: ThreadIndexEntry[] = [];
  private currentThread: Thread | null = null;
  private streamingAssistant = "";

  private composerEl: HTMLTextAreaElement | null = null;

  constructor(leaf: WorkspaceLeaf, orchestrator: AgentOrchestrator) {
    super(leaf);
    this.orchestrator = orchestrator;
  }

  getViewType(): string {
    return CLAUDE_PANEL_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Claude Panel";
  }

  getIcon(): string {
    return "bot";
  }

  async onOpen(): Promise<void> {
    await this.loadInitialThread();
    this.render();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  async createNewThread(title?: string): Promise<void> {
    this.currentThread = await this.orchestrator.createThread(title);
    await this.refreshIndex();
    this.render();
  }

  async attachCurrentNoteFromCommand(): Promise<void> {
    if (!this.currentThread) {
      await this.createNewThread();
    }
    if (!this.currentThread) {
      return;
    }

    try {
      this.currentThread = await this.orchestrator.attachCurrentNote(this.currentThread.id);
      this.render();
      new Notice("Attached active note.");
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    }
  }

  async sendSelectionFromCommand(): Promise<void> {
    if (!this.currentThread) {
      await this.createNewThread();
    }
    if (!this.currentThread) {
      return;
    }

    try {
      this.currentThread = await this.orchestrator.attachSelection(this.currentThread.id);
      this.render();
      await this.sendComposerMessage("Rewrite the attached selection.");
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    }
  }

  async focusComposer(): Promise<void> {
    if (!this.currentThread) {
      await this.loadInitialThread();
      this.render();
    }

    this.composerEl?.focus();
  }

  private async loadInitialThread(): Promise<void> {
    await this.refreshIndex();

    if (this.threadIndex.length === 0) {
      this.currentThread = await this.orchestrator.createThread("New thread");
      await this.refreshIndex();
      return;
    }

    const first = this.threadIndex[0];
    this.currentThread = await this.orchestrator.loadThread(first.id);
  }

  private async refreshIndex(): Promise<void> {
    this.threadIndex = await this.orchestrator.listThreads();
  }

  private render(): void {
    this.contentEl.empty();
    this.contentEl.addClass("claude-panel");

    this.renderHeader();
    this.renderThreads();
    this.renderTranscript();
    this.renderAttachments();
    this.renderProposals();
    this.renderToolLogs();
    this.renderComposer();
  }

  private renderHeader(): void {
    const header = this.contentEl.createDiv({ cls: "claude-header" });

    const modeLabel = header.createEl("label", { text: "Mode" });
    const modeSelect = modeLabel.createEl("select");
    ["plan", "normal", "auto-apply"].forEach((mode) => {
      const option = modeSelect.createEl("option", { value: mode, text: mode });
      if (this.currentThread?.settings.mode === mode) {
        option.selected = true;
      }
    });

    modeSelect.addEventListener("change", async () => {
      if (!this.currentThread) {
        return;
      }
      this.currentThread = await this.orchestrator.setMode(this.currentThread.id, modeSelect.value as Thread["settings"]["mode"]);
      this.render();
    });

    const modelLabel = header.createEl("label", { text: "Model" });
    const modelSelect = modelLabel.createEl("select");
    ["claude-code"].forEach((model) => {
      const option = modelSelect.createEl("option", { value: model, text: model });
      if (this.currentThread?.settings.model === model) {
        option.selected = true;
      }
    });
    modelSelect.disabled = true;

    modelSelect.addEventListener("change", async () => {
      if (!this.currentThread) {
        return;
      }
      this.currentThread = await this.orchestrator.setModel(this.currentThread.id, modelSelect.value);
      this.render();
    });

    const newButton = header.createEl("button", { text: "New Thread" });
    newButton.addEventListener("click", async () => {
      await this.createNewThread();
    });

    const attachButton = header.createEl("button", { text: "Attach Current Note" });
    attachButton.addEventListener("click", async () => {
      await this.attachCurrentNoteFromCommand();
    });

    const selectionButton = header.createEl("button", { text: "Send Selection" });
    selectionButton.addEventListener("click", async () => {
      await this.sendSelectionFromCommand();
    });

    if (this.currentThread?.claudeCodeSessionId) {
      header.createDiv({
        cls: "claude-muted",
        text: `Session: ${this.currentThread.claudeCodeSessionId}`
      });

      const resetSessionButton = header.createEl("button", { text: "Reset Session" });
      resetSessionButton.addEventListener("click", async () => {
        if (!this.currentThread) {
          return;
        }
        this.currentThread = await this.orchestrator.resetClaudeSession(this.currentThread.id);
        this.render();
      });
    }
  }

  private renderThreads(): void {
    const section = this.contentEl.createDiv({ cls: "claude-threads" });
    section.createEl("span", { text: "Thread" });

    const select = section.createEl("select");
    for (const thread of this.threadIndex) {
      const option = select.createEl("option", {
        value: thread.id,
        text: `${thread.title} (${new Date(thread.updatedAt).toLocaleString()})`
      });

      if (thread.id === this.currentThread?.id) {
        option.selected = true;
      }
    }

    select.addEventListener("change", async () => {
      this.currentThread = await this.orchestrator.loadThread(select.value);
      this.streamingAssistant = "";
      this.render();
    });
  }

  private renderTranscript(): void {
    const section = this.contentEl.createDiv({ cls: "claude-transcript" });

    if (!this.currentThread || this.currentThread.messages.length === 0) {
      section.createEl("div", { text: "No messages yet.", cls: "claude-muted" });
      return;
    }

    for (const message of this.currentThread.messages) {
      const item = section.createDiv({ cls: "claude-message" });
      item.createDiv({ cls: "claude-message-role", text: message.role });
      item.createDiv({ text: message.content });
    }

    if (this.streamingAssistant) {
      const item = section.createDiv({ cls: "claude-message" });
      item.createDiv({ cls: "claude-message-role", text: "assistant (streaming)" });
      item.createDiv({ text: this.streamingAssistant });
    }
  }

  private renderAttachments(): void {
    const section = this.contentEl.createDiv({ cls: "claude-attachments" });
    section.createDiv({ text: "Attachments" });

    if (!this.currentThread || this.currentThread.attachments.length === 0) {
      section.createDiv({ text: "No attachments.", cls: "claude-muted" });
      return;
    }

    const list = section.createDiv({ cls: "claude-attachments-list" });

    for (const attachment of this.currentThread.attachments) {
      const chip = list.createDiv({ cls: "claude-attachment-chip" });
      chip.createDiv({ text: `${attachment.type}: ${attachment.label}` });

      const controls = chip.createDiv({ cls: "claude-actions" });
      const includeLabel = controls.createEl("label", { text: "Include" });
      const includeToggle = includeLabel.createEl("input", {
        attr: { type: "checkbox" }
      }) as HTMLInputElement;
      includeToggle.checked = attachment.included;
      includeToggle.addEventListener("change", async () => {
        if (!this.currentThread) {
          return;
        }
        this.currentThread = await this.orchestrator.toggleAttachment(
          this.currentThread.id,
          attachment.id,
          includeToggle.checked
        );
        this.render();
      });

      if (attachment.type === "note" && attachment.source.path) {
        const refreshButton = controls.createEl("button", { text: "Refresh" });
        refreshButton.addEventListener("click", async () => {
          if (!this.currentThread) {
            return;
          }
          this.currentThread = await this.orchestrator.refreshAttachment(this.currentThread.id, attachment.id);
          this.render();
        });
      }

      chip.createDiv({
        cls: "claude-muted",
        text: `Snapshot size: ${attachment.contentSnapshot.length} chars`
      });
    }
  }

  private renderProposals(): void {
    const section = this.contentEl.createDiv({ cls: "claude-proposals" });
    section.createDiv({ text: "Proposed changes" });

    if (!this.currentThread || this.currentThread.proposedChanges.length === 0) {
      section.createDiv({ text: "No proposed changes.", cls: "claude-muted" });
      return;
    }

    const actions = section.createDiv({ cls: "claude-actions" });
    const applyAllButton = actions.createEl("button", { text: "Apply All" });
    applyAllButton.addEventListener("click", async () => {
      if (!this.currentThread) {
        return;
      }

      const pending = this.currentThread.proposedChanges.filter((change) => change.status === "proposed");
      if (pending.length === 0) {
        new Notice("No pending proposals to apply.");
        return;
      }

      if (this.currentThread.settings.mode === "normal") {
        const approved = await this.confirmBatchApply(pending.map((change) => change.path));
        if (!approved) {
          return;
        }
      }

      this.currentThread = await this.orchestrator.applyAll(this.currentThread.id);
      this.render();
    });

    const rejectAllButton = actions.createEl("button", { text: "Reject All" });
    rejectAllButton.addEventListener("click", async () => {
      if (!this.currentThread) {
        return;
      }
      this.currentThread = await this.orchestrator.rejectAll(this.currentThread.id);
      this.render();
    });

    const list = section.createDiv({ cls: "claude-proposals-list" });

    for (const proposal of this.currentThread.proposedChanges) {
      const item = list.createDiv({ cls: "claude-proposal-item" });
      item.createDiv({ text: `${proposal.action}: ${proposal.path}` });
      item.createDiv({ cls: "claude-muted", text: `Status: ${proposal.status}` });

      if (proposal.rationale) {
        item.createDiv({ cls: "claude-muted", text: proposal.rationale });
      }

      if (proposal.diff) {
        const diffEl = item.createDiv({ cls: "claude-diff" });
        for (const line of proposal.diff.split("\n")) {
          const lineEl = diffEl.createDiv({ cls: "claude-diff-line", text: line || " " });
          if (line.startsWith("+")) {
            lineEl.addClass("claude-diff-line-add");
          } else if (line.startsWith("-")) {
            lineEl.addClass("claude-diff-line-remove");
          } else {
            lineEl.addClass("claude-diff-line-context");
          }
        }
      }

      if (proposal.error) {
        item.createDiv({ cls: "claude-muted", text: `Error: ${proposal.error}` });
      }

      if (proposal.status === "proposed") {
        const controls = item.createDiv({ cls: "claude-actions" });
        const applyButton = controls.createEl("button", { text: "Apply" });
        applyButton.addEventListener("click", async () => {
          if (!this.currentThread) {
            return;
          }

          if (this.currentThread.settings.mode === "normal") {
            const approved = await this.confirmBatchApply([proposal.path]);
            if (!approved) {
              return;
            }
          }

          this.currentThread = await this.orchestrator.applyChange(this.currentThread.id, proposal.id);
          this.render();
        });

        const rejectButton = controls.createEl("button", { text: "Reject" });
        rejectButton.addEventListener("click", async () => {
          if (!this.currentThread) {
            return;
          }
          this.currentThread = await this.orchestrator.rejectChange(this.currentThread.id, proposal.id);
          this.render();
        });
      }
    }
  }

  private renderToolLogs(): void {
    const section = this.contentEl.createDiv({ cls: "claude-tools" });
    section.createDiv({ text: "Tool log" });

    if (!this.currentThread || this.currentThread.toolLogs.length === 0) {
      section.createDiv({ text: "No tool calls yet.", cls: "claude-muted" });
      return;
    }

    const details = section.createEl("details");
    details.createEl("summary", { text: `Entries (${this.currentThread.toolLogs.length})` });

    for (const log of [...this.currentThread.toolLogs].reverse().slice(0, 30)) {
      const row = details.createDiv({ cls: "claude-message" });
      row.createDiv({ text: `${log.success ? "OK" : "ERR"} ${log.name}` });
      row.createDiv({ cls: "claude-muted", text: JSON.stringify(log.args) });
      if (log.result) {
        row.createDiv({ cls: "claude-muted", text: log.result });
      }
      if (log.error) {
        row.createDiv({ cls: "claude-muted", text: log.error });
      }
    }
  }

  private renderComposer(): void {
    const section = this.contentEl.createDiv({ cls: "claude-composer" });
    section.createDiv({ text: "Message" });

    this.composerEl = section.createEl("textarea", {
      attr: { placeholder: "Ask Claude Panel to read/search/propose edits..." }
    });

    const actions = section.createDiv({ cls: "claude-actions" });
    const sendButton = actions.createEl("button", { text: "Send" });

    sendButton.addEventListener("click", async () => {
      const value = this.composerEl?.value ?? "";
      await this.sendComposerMessage(value);
    });
  }

  private async sendComposerMessage(content: string): Promise<void> {
    const text = content.trim();
    if (!text) {
      return;
    }

    if (!this.currentThread) {
      await this.createNewThread();
    }

    if (!this.currentThread) {
      return;
    }

    this.streamingAssistant = "";
    this.render();

    this.currentThread = await this.orchestrator.sendMessage(this.currentThread.id, text, {
      onToken: (partial) => {
        this.streamingAssistant = partial;
        this.render();
      }
    });

    this.streamingAssistant = "";
    await this.refreshIndex();

    if (this.composerEl) {
      this.composerEl.value = "";
    }

    this.render();
  }

  private async confirmBatchApply(paths: string[]): Promise<boolean> {
    return new Promise((resolve) => {
      const modal = new BatchApplyModal(this.leaf, paths, resolve);
      modal.open();
    });
  }
}
