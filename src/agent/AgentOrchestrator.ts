import { Notice } from "obsidian";
import { ApplyEngine } from "../diff/ApplyEngine";
import { DiffEngine } from "../diff/DiffEngine";
import { ModelClient } from "../model/ModelClient";
import { ThreadStore, makeEntityId, makeTimestamp } from "../state/ThreadStore";
import {
  AgentMode,
  Attachment,
  ModelResult,
  Message,
  ProposedChange,
  ProposedChangeInput,
  Thread,
  ToolLogEntry
} from "../state/types";
import { EditorTools } from "../tools/EditorTools";
import { VaultTools } from "../tools/VaultTools";
import { PermissionManager } from "./PermissionManager";

interface SendMessageOptions {
  onToken?: (partial: string) => void;
}

export class AgentOrchestrator {
  private store: ThreadStore;
  private vaultTools: VaultTools;
  private editorTools: EditorTools;
  private modelClients: Map<string, ModelClient>;
  private applyEngine: ApplyEngine;
  private permissionManager: PermissionManager;
  private defaultModel: () => string;

  constructor(args: {
    store: ThreadStore;
    vaultTools: VaultTools;
    editorTools: EditorTools;
    models: ModelClient[];
    applyEngine: ApplyEngine;
    permissionManager: PermissionManager;
    defaultModel?: () => string;
  }) {
    this.store = args.store;
    this.vaultTools = args.vaultTools;
    this.editorTools = args.editorTools;
    this.modelClients = new Map(args.models.map((model) => [model.id, model]));
    this.applyEngine = args.applyEngine;
    this.permissionManager = args.permissionManager;
    this.defaultModel = args.defaultModel ?? (() => "claude-code");
  }

  async listThreads() {
    return this.store.listThreads();
  }

  async createThread(title?: string): Promise<Thread> {
    return this.store.createThread(title, { model: this.defaultModel() });
  }

  async loadThread(threadId: string): Promise<Thread | null> {
    const thread = await this.store.getThread(threadId);
    if (!thread) {
      return null;
    }

    if (thread.settings.model !== "claude-code") {
      thread.settings.model = "claude-code";
      await this.store.saveThread(thread);
    }

    return thread;
  }

  async setMode(threadId: string, mode: AgentMode): Promise<Thread> {
    return this.store.updateThread(threadId, (thread) => {
      thread.settings.mode = mode;
    });
  }

  async setModel(threadId: string, model: string): Promise<Thread> {
    return this.store.updateThread(threadId, (thread) => {
      thread.settings.model = model;
    });
  }

  async resetClaudeSession(threadId: string): Promise<Thread> {
    return this.store.updateThread(threadId, (thread) => {
      const previous = thread.claudeCodeSessionId;
      thread.claudeCodeSessionId = undefined;
      thread.claudeCodeSessionUpdatedAt = undefined;
      this.logTool(thread, "claude_session_reset", { previous }, true, "Cleared stored Claude Code session");
    });
  }

  async attachCurrentNote(threadId: string): Promise<Thread> {
    const note = await this.editorTools.getActiveNote();
    if (!note) {
      throw new Error("No active note to attach.");
    }

    const attachment: Attachment = {
      id: makeEntityId("attachment"),
      type: "note",
      label: note.path,
      source: { path: note.path },
      contentSnapshot: note.content,
      included: true,
      createdAt: makeTimestamp(),
      lastRefreshedAt: makeTimestamp()
    };

    return this.store.updateThread(threadId, (thread) => {
      thread.attachments.push(attachment);
      this.logTool(thread, "get_active_note", {}, true, `Attached ${note.path}`);
    });
  }

  async attachSelection(threadId: string): Promise<Thread> {
    const selection = this.editorTools.getSelection();
    if (!selection) {
      throw new Error("No active selection to attach.");
    }

    const selectionAttachment: Attachment = {
      id: makeEntityId("attachment"),
      type: "selection",
      label: `Selection from ${selection.path}`,
      source: {
        path: selection.path,
        range: selection.range
      },
      contentSnapshot: selection.selectedText,
      included: true,
      createdAt: makeTimestamp(),
      lastRefreshedAt: makeTimestamp()
    };

    const noteAttachment: Attachment = {
      id: makeEntityId("attachment"),
      type: "note",
      label: selection.path,
      source: { path: selection.path },
      contentSnapshot: selection.fullContent,
      included: true,
      createdAt: makeTimestamp(),
      lastRefreshedAt: makeTimestamp()
    };

    return this.store.updateThread(threadId, (thread) => {
      thread.attachments.push(selectionAttachment, noteAttachment);
      this.logTool(thread, "get_selection", {}, true, `Attached selection from ${selection.path}`);
    });
  }

  async toggleAttachment(threadId: string, attachmentId: string, included: boolean): Promise<Thread> {
    return this.store.updateThread(threadId, (thread) => {
      const attachment = thread.attachments.find((candidate) => candidate.id === attachmentId);
      if (attachment) {
        attachment.included = included;
      }
    });
  }

  async refreshAttachment(threadId: string, attachmentId: string): Promise<Thread> {
    const thread = await this.requireThread(threadId);
    const attachment = thread.attachments.find((candidate) => candidate.id === attachmentId);
    if (!attachment || !attachment.source.path) {
      return thread;
    }

    const note = await this.vaultTools.readNote(attachment.source.path);
    if (!note) {
      this.logTool(thread, "read_note", { path: attachment.source.path }, false, undefined, "Attachment source note not found");
      await this.store.saveThread(thread);
      return thread;
    }

    attachment.contentSnapshot = note.content;
    attachment.lastRefreshedAt = makeTimestamp();
    this.logTool(thread, "read_note", { path: attachment.source.path }, true, "Refreshed attachment snapshot");
    await this.store.saveThread(thread);
    return thread;
  }

  async sendMessage(threadId: string, userMessage: string, options?: SendMessageOptions): Promise<Thread> {
    let working =
      (await this.store.getThread(threadId)) ||
      (await this.createThread(userMessage.slice(0, 40) || "New thread"));

    const user: Message = {
      id: makeEntityId("msg"),
      role: "user",
      content: userMessage,
      createdAt: makeTimestamp()
    };

    working.messages.push(user);

    const searchQuery = this.tryExtractSearchQuery(userMessage);
    if (searchQuery) {
      const results = await this.vaultTools.searchNotes(searchQuery, 8);
      const attachment: Attachment = {
        id: makeEntityId("attachment"),
        type: "search",
        label: `Search: ${searchQuery}`,
        source: { query: searchQuery },
        contentSnapshot: results
          .map((result, idx) => `${idx + 1}. ${result.path}\n${result.snippet}`)
          .join("\n\n"),
        included: true,
        createdAt: makeTimestamp(),
        lastRefreshedAt: makeTimestamp()
      };
      working.attachments.push(attachment);
      this.logTool(working, "search_notes", { query: searchQuery, limit: 8 }, true, `Found ${results.length} results`);
    }

    const attachments = working.attachments.filter((attachment) => attachment.included);
    const modelId = working.settings.model || "claude-code";
    const model = this.modelClients.get(modelId) ?? this.modelClients.get("claude-code");
    if (!model) {
      throw new Error("No model clients registered.");
    }
    const previousSessionId = working.claudeCodeSessionId;
    this.logTool(
      working,
      "claude_session_use",
      { sessionId: previousSessionId ?? null },
      true,
      previousSessionId ? "Resuming Claude Code session" : "Starting new Claude Code session"
    );

    let result: ModelResult;
    try {
      result = await model.stream(
        {
          thread: working,
          userMessage,
          attachments
        },
        {
          onToken: options?.onToken
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Model error: ${message}`);
      this.logTool(working, "model_stream", { model: model.id }, false, undefined, message);
      await this.store.saveThread(working);
      return working;
    }

    if (result.claudeCodeSessionId && result.claudeCodeSessionId !== previousSessionId) {
      working.claudeCodeSessionId = result.claudeCodeSessionId;
      working.claudeCodeSessionUpdatedAt = makeTimestamp();
      this.logTool(
        working,
        "claude_session",
        { previous: previousSessionId, current: result.claudeCodeSessionId },
        true,
        previousSessionId ? "Resumed Claude Code session" : "Created Claude Code session"
      );
    }

    const assistant: Message = {
      id: makeEntityId("msg"),
      role: "assistant",
      content: result.assistantText,
      createdAt: makeTimestamp()
    };
    working.messages.push(assistant);

    const generated = await this.materializeProposals(result.proposals, working);
    working.proposedChanges.push(...generated);

    this.logTool(
      working,
      "propose_changes",
      { count: generated.length },
      true,
      generated.length ? `Prepared ${generated.length} proposal(s)` : "No file changes proposed"
    );

    if (this.permissionManager.shouldAutoApply(working.settings.mode)) {
      working = await this.applyAllOnThread(working);
    } else if (!this.permissionManager.canWrite(working.settings.mode)) {
      this.logTool(working, "permission_gate", { mode: working.settings.mode }, true, "Plan mode blocks write execution");
    }

    await this.store.saveThread(working);
    return working;
  }

  async applyChange(threadId: string, changeId: string): Promise<Thread> {
    const thread = await this.requireThread(threadId);
    const change = thread.proposedChanges.find((candidate) => candidate.id === changeId);
    if (!change) {
      throw new Error("Proposed change not found.");
    }

    if (change.status !== "proposed") {
      return thread;
    }

    if (!this.permissionManager.canWrite(thread.settings.mode)) {
      new Notice("Plan mode: writes are disabled.");
      return thread;
    }

    const result = await this.applyEngine.apply(change);
    if (result.ok) {
      change.status = "applied";
      change.appliedAt = makeTimestamp();
      change.error = undefined;
      this.logTool(thread, "apply_change", { path: change.path, action: change.action }, true, "Applied change");
    } else {
      change.error = result.error;
      this.logTool(thread, "apply_change", { path: change.path, action: change.action }, false, undefined, result.error);
      new Notice(`Apply failed: ${result.error}`);
    }

    await this.store.saveThread(thread);
    return thread;
  }

  async rejectChange(threadId: string, changeId: string): Promise<Thread> {
    return this.store.updateThread(threadId, (thread) => {
      const change = thread.proposedChanges.find((candidate) => candidate.id === changeId);
      if (!change || change.status !== "proposed") {
        return;
      }
      change.status = "rejected";
      change.rejectedAt = makeTimestamp();
      this.logTool(thread, "reject_change", { path: change.path }, true, "Rejected change");
    });
  }

  async applyAll(threadId: string): Promise<Thread> {
    const thread = await this.requireThread(threadId);
    return this.applyAllOnThread(thread);
  }

  async rejectAll(threadId: string): Promise<Thread> {
    return this.store.updateThread(threadId, (thread) => {
      for (const change of thread.proposedChanges) {
        if (change.status === "proposed") {
          change.status = "rejected";
          change.rejectedAt = makeTimestamp();
        }
      }
      this.logTool(thread, "reject_all", {}, true, "Rejected all pending proposals");
    });
  }

  private async applyAllOnThread(thread: Thread): Promise<Thread> {
    if (!this.permissionManager.canWrite(thread.settings.mode)) {
      return thread;
    }

    for (const change of thread.proposedChanges) {
      if (change.status !== "proposed") {
        continue;
      }

      const result = await this.applyEngine.apply(change);
      if (result.ok) {
        change.status = "applied";
        change.appliedAt = makeTimestamp();
        change.error = undefined;
        this.logTool(thread, "apply_change", { path: change.path, action: change.action }, true, "Applied change");
      } else {
        change.error = result.error;
        this.logTool(thread, "apply_change", { path: change.path, action: change.action }, false, undefined, result.error);
      }
    }

    await this.store.saveThread(thread);
    return thread;
  }

  private async materializeProposals(inputs: ProposedChangeInput[], thread: Thread): Promise<ProposedChange[]> {
    const out: ProposedChange[] = [];

    for (const input of inputs) {
      const baseContent = await this.resolveBaseContent(input, thread);
      const proposedContent = input.content;
      const diff =
        typeof proposedContent === "string"
          ? DiffEngine.renderUnified(baseContent, proposedContent)
          : undefined;

      out.push({
        id: makeEntityId("change"),
        action: input.action,
        path: input.path,
        from: input.from,
        to: input.to,
        baseHash: DiffEngine.hashContent(baseContent),
        proposedContent,
        status: "proposed",
        diff,
        rationale: input.rationale,
        createdAt: makeTimestamp()
      });
    }

    return out;
  }

  private async resolveBaseContent(input: ProposedChangeInput, thread: Thread): Promise<string> {
    if (input.action === "create") {
      return "";
    }

    const fromPath = input.action === "rename" ? input.from ?? input.path : input.path;
    const note = fromPath ? await this.vaultTools.readNote(fromPath) : null;
    if (note) {
      return note.content;
    }

    const attached = thread.attachments.find((attachment) => attachment.source.path === fromPath);
    return attached?.contentSnapshot ?? "";
  }

  private tryExtractSearchQuery(content: string): string | null {
    const match = content.match(/find\s+notes\s+about\s+(.+?)(?:\.|$)/i);
    return match ? match[1].trim() : null;
  }

  private async requireThread(threadId: string): Promise<Thread> {
    const thread = await this.store.getThread(threadId);
    if (!thread) {
      throw new Error("Thread not found.");
    }
    return thread;
  }

  private logTool(
    thread: Thread,
    name: string,
    args: Record<string, unknown>,
    success: boolean,
    result?: string,
    error?: string
  ): void {
    const entry: ToolLogEntry = {
      id: makeEntityId("tool"),
      name,
      args,
      success,
      result,
      error,
      createdAt: makeTimestamp()
    };

    thread.toolLogs.push(entry);
  }
}
