import { ItemView, Modal, Notice, WorkspaceLeaf } from "obsidian";
import { AgentOrchestrator } from "../agent/AgentOrchestrator";
import { RuntimeDiagnosticsResult, RuntimeSetupInfo } from "../model/ModelClient";
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
  private runtimeSetupInfo: RuntimeSetupInfo | null = null;
  private runtimeDiagnostics: RuntimeDiagnosticsResult | null = null;
  private runtimeDiagnosticsAt: string | null = null;
  private runtimeDiagnosticsRunning = false;

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
    this.runtimeSetupInfo = this.orchestrator.getRuntimeSetupInfo(this.currentThread);

    this.renderHeader();
    this.renderRuntimeSetup();
    this.renderThreads();
    this.renderTranscript();
    this.renderAttachments();
    this.renderProposals();
    this.renderToolLogs();
    this.renderComposer();
  }

  private renderHeader(): void {
    const header = this.contentEl.createDiv({ cls: "claude-header" });

    header.createDiv({ cls: "claude-runtime-pill", text: "Claude Code Runtime" });

    const modeGroup = header.createDiv({ cls: "claude-mode-group" });
    ["plan", "normal", "auto-apply"].forEach((mode) => {
      const button = modeGroup.createEl("button", {
        text: mode,
        cls: mode === this.currentThread?.settings.mode ? "is-active" : ""
      });
      button.addEventListener("click", async () => {
        if (!this.currentThread) {
          return;
        }
        this.currentThread = await this.orchestrator.setMode(
          this.currentThread.id,
          mode as Thread["settings"]["mode"]
        );
        this.render();
      });
    });

    const actions = header.createDiv({ cls: "claude-header-actions" });
    const attachButton = actions.createEl("button", { text: "Attach Current Note" });
    attachButton.addEventListener("click", async () => {
      await this.attachCurrentNoteFromCommand();
    });

    const selectionButton = actions.createEl("button", { text: "Send Selection" });
    selectionButton.addEventListener("click", async () => {
      await this.sendSelectionFromCommand();
    });

    if (this.currentThread?.claudeCodeSessionId) {
      actions.createDiv({
        cls: "claude-session-chip",
        text: `session ${this.currentThread.claudeCodeSessionId.slice(0, 8)}`
      });

      const resetSessionButton = actions.createEl("button", { text: "Reset Session" });
      resetSessionButton.addClass("mod-warning");
      resetSessionButton.addEventListener("click", async () => {
        if (!this.currentThread) {
          return;
        }
        this.currentThread = await this.orchestrator.resetClaudeSession(this.currentThread.id);
        this.render();
      });
    } else {
      actions.createDiv({
        cls: "claude-session-chip",
        text: "new session"
      });
    }
  }

  private renderRuntimeSetup(): void {
    const section = this.contentEl.createDiv({ cls: "claude-runtime-setup" });
    section.createDiv({ cls: "claude-section-title", text: "Runtime setup" });

    if (!this.runtimeSetupInfo) {
      section.createDiv({ cls: "claude-muted", text: "Runtime setup unavailable for current model." });
      return;
    }

    section.createDiv({
      cls: "claude-muted",
      text: `Executable: ${this.runtimeSetupInfo.executable}`
    });
    section.createDiv({
      cls: "claude-muted",
      text: `Vault cwd: ${this.runtimeSetupInfo.cwd}`
    });

    const actions = section.createDiv({ cls: "claude-actions" });
    const runCheckButton = actions.createEl("button", {
      text: this.runtimeDiagnosticsRunning ? "Running checks..." : "Run Runtime Check"
    });
    runCheckButton.disabled = this.runtimeDiagnosticsRunning;
    runCheckButton.addEventListener("click", async () => {
      if (!this.currentThread) {
        return;
      }

      this.runtimeDiagnosticsRunning = true;
      this.render();
      try {
        const { thread, diagnostics } = await this.orchestrator.runRuntimeDiagnostics(this.currentThread.id);
        this.currentThread = thread;
        this.runtimeDiagnostics = diagnostics;
        this.runtimeDiagnosticsAt = new Date().toISOString();
        new Notice(diagnostics.summary);
      } catch (error) {
        new Notice(error instanceof Error ? error.message : String(error));
      } finally {
        this.runtimeDiagnosticsRunning = false;
        this.render();
      }
    });

    const openStatusButton = actions.createEl("button", { text: "Terminal /status" });
    openStatusButton.disabled = !this.runtimeSetupInfo.supportsTerminalLaunch;
    openStatusButton.addEventListener("click", async () => {
      if (!this.currentThread) {
        return;
      }
      try {
        const { thread, result } = await this.orchestrator.launchRuntimeTerminal(this.currentThread.id, "status");
        this.currentThread = thread;
        new Notice(result.message);
        this.render();
      } catch (error) {
        new Notice(error instanceof Error ? error.message : String(error));
      }
    });

    const openLoginButton = actions.createEl("button", { text: "Terminal login" });
    openLoginButton.disabled = !this.runtimeSetupInfo.supportsTerminalLaunch;
    openLoginButton.addEventListener("click", async () => {
      if (!this.currentThread) {
        return;
      }
      try {
        const { thread, result } = await this.orchestrator.launchRuntimeTerminal(this.currentThread.id, "login");
        this.currentThread = thread;
        new Notice(result.message);
        this.render();
      } catch (error) {
        new Notice(error instanceof Error ? error.message : String(error));
      }
    });

    const bootstrapButton = actions.createEl("button", { text: "Init .claude + CLAUDE.md" });
    bootstrapButton.addEventListener("click", async () => {
      if (!this.currentThread) {
        return;
      }
      try {
        const { thread, created, existing } = await this.orchestrator.initializeClaudeWorkspace(this.currentThread.id);
        this.currentThread = thread;
        const summary = created.length
          ? `Created ${created.join(", ")}`
          : `Already existed: ${existing.join(", ") || ".claude, CLAUDE.md"}`;
        new Notice(summary);
        this.render();
      } catch (error) {
        new Notice(error instanceof Error ? error.message : String(error));
      }
    });

    const docsButton = actions.createEl("button", { text: "Open Claude docs" });
    docsButton.addEventListener("click", () => {
      window.open("https://code.claude.com/docs/en/vs-code", "_blank");
    });

    const commands = section.createDiv({ cls: "claude-runtime-commands" });
    for (const command of this.runtimeSetupInfo.commands) {
      const row = commands.createDiv({ cls: "claude-runtime-command" });
      const body = row.createDiv({ cls: "claude-runtime-command-body" });
      body.createDiv({ cls: "claude-runtime-command-label", text: command.label });
      body.createDiv({ cls: "claude-muted", text: command.description });
      body.createEl("code", { text: command.command });

      const copyButton = row.createEl("button", { text: "Copy" });
      copyButton.addEventListener("click", async () => {
        const copied = await this.copyToClipboard(command.command);
        if (copied) {
          new Notice(`Copied: ${command.label}`);
        } else {
          new Notice("Unable to copy command in this environment.");
        }
      });
    }

    if (this.runtimeDiagnostics) {
      const diag = section.createDiv({
        cls: `claude-runtime-diagnostics ${this.runtimeDiagnostics.success ? "is-success" : "is-failed"}`
      });
      diag.createDiv({
        cls: "claude-runtime-diagnostics-summary",
        text: this.runtimeDiagnostics.summary
      });
      if (this.runtimeDiagnosticsAt) {
        diag.createDiv({
          cls: "claude-muted",
          text: `Last run: ${new Date(this.runtimeDiagnosticsAt).toLocaleString()}`
        });
      }

      const details = diag.createEl("details");
      details.createEl("summary", { text: "Diagnostic output" });
      for (const entry of this.runtimeDiagnostics.entries) {
        const entryEl = details.createDiv({ cls: "claude-runtime-diagnostic-entry" });
        entryEl.createDiv({
          text: `${entry.success ? "OK" : "ERR"} ${entry.label}`
        });
        entryEl.createEl("code", { text: entry.command });
        entryEl.createEl("pre", { text: entry.output });
      }
    }
  }

  private renderThreads(): void {
    const section = this.contentEl.createDiv({ cls: "claude-threads" });
    section.createDiv({ cls: "claude-section-title", text: "Thread" });

    const row = section.createDiv({ cls: "claude-thread-row" });
    const select = row.createEl("select");
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

    const newButton = row.createEl("button", { text: "New" });
    newButton.addClass("mod-cta");
    newButton.addEventListener("click", async () => {
      await this.createNewThread();
    });
  }

  private renderTranscript(): void {
    const section = this.contentEl.createDiv({ cls: "claude-transcript" });
    section.createDiv({ cls: "claude-section-title", text: "Conversation" });

    if (!this.currentThread || this.currentThread.messages.length === 0) {
      section.createEl("div", { text: "No messages yet.", cls: "claude-muted" });
      return;
    }

    for (const message of this.currentThread.messages) {
      const item = section.createDiv({ cls: `claude-message claude-message-${message.role}` });
      item.createDiv({ cls: "claude-message-role", text: message.role });
      item.createEl("pre", { cls: "claude-message-content", text: message.content });
    }

    if (this.streamingAssistant) {
      const item = section.createDiv({ cls: "claude-message claude-message-assistant claude-message-streaming" });
      item.createDiv({ cls: "claude-message-role", text: "assistant (streaming)" });
      item.createEl("pre", { cls: "claude-message-content", text: this.streamingAssistant });
    }
  }

  private renderAttachments(): void {
    const section = this.contentEl.createDiv({ cls: "claude-attachments" });
    section.createDiv({ cls: "claude-section-title", text: "Attachments" });

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
    section.createDiv({ cls: "claude-section-title", text: "Proposed changes" });

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
    section.createDiv({ cls: "claude-section-title", text: "Tool log" });

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
    section.createDiv({ cls: "claude-section-title", text: "Message" });

    this.composerEl = section.createEl("textarea", {
      attr: { placeholder: "Ask Claude Panel to read/search/propose edits..." }
    });
    this.composerEl.addEventListener("keydown", async (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        const value = this.composerEl?.value ?? "";
        await this.sendComposerMessage(value);
      }
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

  private async copyToClipboard(value: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = value;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(textarea);
        return ok;
      } catch {
        return false;
      }
    }
  }
}
