"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => ClaudePanelPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian7 = require("obsidian");

// src/agent/AgentOrchestrator.ts
var import_obsidian2 = require("obsidian");

// src/diff/DiffEngine.ts
function splitLines(input) {
  return input.replace(/\r\n/g, "\n").split("\n");
}
var DiffEngine = class {
  static hashContent(content) {
    let hash = 2166136261;
    for (let i = 0; i < content.length; i += 1) {
      hash ^= content.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }
  static diffLines(before, after) {
    const a = splitLines(before);
    const b = splitLines(after);
    const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
    for (let i2 = a.length - 1; i2 >= 0; i2 -= 1) {
      for (let j2 = b.length - 1; j2 >= 0; j2 -= 1) {
        if (a[i2] === b[j2]) {
          dp[i2][j2] = dp[i2 + 1][j2 + 1] + 1;
        } else {
          dp[i2][j2] = Math.max(dp[i2 + 1][j2], dp[i2][j2 + 1]);
        }
      }
    }
    const out = [];
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) {
        out.push({ type: "context", text: a[i] });
        i += 1;
        j += 1;
        continue;
      }
      if (dp[i + 1][j] >= dp[i][j + 1]) {
        out.push({ type: "remove", text: a[i] });
        i += 1;
      } else {
        out.push({ type: "add", text: b[j] });
        j += 1;
      }
    }
    while (i < a.length) {
      out.push({ type: "remove", text: a[i] });
      i += 1;
    }
    while (j < b.length) {
      out.push({ type: "add", text: b[j] });
      j += 1;
    }
    return out;
  }
  static renderUnified(before, after) {
    return this.diffLines(before, after).map((line) => {
      if (line.type === "add") {
        return `+ ${line.text}`;
      }
      if (line.type === "remove") {
        return `- ${line.text}`;
      }
      return `  ${line.text}`;
    }).join("\n");
  }
};

// src/state/ThreadStore.ts
var import_obsidian = require("obsidian");
var ROOT_DIR = ".claude-panel";
var THREADS_DIR = (0, import_obsidian.normalizePath)(`${ROOT_DIR}/threads`);
var INDEX_PATH = (0, import_obsidian.normalizePath)(`${ROOT_DIR}/index.json`);
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
function defaultThread(title) {
  const stamp = nowIso();
  return {
    id: makeId("thread"),
    title: (title == null ? void 0 : title.trim()) || "New thread",
    createdAt: stamp,
    updatedAt: stamp,
    messages: [],
    attachments: [],
    proposedChanges: [],
    toolLogs: [],
    settings: {
      mode: "normal",
      model: "mock"
    }
  };
}
var ThreadStore = class {
  constructor(app) {
    this.app = app;
  }
  async init() {
    await this.ensureFolder(ROOT_DIR);
    await this.ensureFolder(THREADS_DIR);
    if (!await this.app.vault.adapter.exists(INDEX_PATH)) {
      const initial = { threads: [] };
      await this.app.vault.adapter.write(INDEX_PATH, JSON.stringify(initial, null, 2));
    }
  }
  async listThreads() {
    const index = await this.readIndex();
    return [...index.threads].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async createThread(title) {
    const thread = defaultThread(title);
    await this.saveThread(thread);
    return thread;
  }
  async getThread(threadId) {
    const path = this.threadPath(threadId);
    if (!await this.app.vault.adapter.exists(path)) {
      return null;
    }
    try {
      const raw = await this.app.vault.adapter.read(path);
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }
  async saveThread(thread) {
    thread.updatedAt = nowIso();
    const path = this.threadPath(thread.id);
    await this.app.vault.adapter.write(path, JSON.stringify(thread, null, 2));
    await this.upsertIndexEntry({
      id: thread.id,
      title: thread.title,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt
    });
  }
  async updateThread(threadId, mutate) {
    const thread = await this.getThread(threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }
    mutate(thread);
    await this.saveThread(thread);
    return thread;
  }
  async ensureFolder(path) {
    const normalized = (0, import_obsidian.normalizePath)(path);
    if (await this.app.vault.adapter.exists(normalized)) {
      return;
    }
    await this.app.vault.adapter.mkdir(normalized);
  }
  threadPath(threadId) {
    return (0, import_obsidian.normalizePath)(`${THREADS_DIR}/${threadId}.json`);
  }
  async readIndex() {
    try {
      const raw = await this.app.vault.adapter.read(INDEX_PATH);
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.threads)) {
        return { threads: [] };
      }
      return parsed;
    } catch (e) {
      return { threads: [] };
    }
  }
  async upsertIndexEntry(entry) {
    const index = await this.readIndex();
    const existingIdx = index.threads.findIndex((candidate) => candidate.id === entry.id);
    if (existingIdx >= 0) {
      index.threads[existingIdx] = entry;
    } else {
      index.threads.push(entry);
    }
    index.threads.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    await this.app.vault.adapter.write(INDEX_PATH, JSON.stringify(index, null, 2));
  }
};
function makeEntityId(prefix) {
  return makeId(prefix);
}
function makeTimestamp() {
  return nowIso();
}

// src/agent/AgentOrchestrator.ts
var AgentOrchestrator = class {
  constructor(args) {
    this.store = args.store;
    this.vaultTools = args.vaultTools;
    this.editorTools = args.editorTools;
    this.modelClients = new Map(args.models.map((model) => [model.id, model]));
    this.applyEngine = args.applyEngine;
    this.permissionManager = args.permissionManager;
  }
  async listThreads() {
    return this.store.listThreads();
  }
  async createThread(title) {
    return this.store.createThread(title);
  }
  async loadThread(threadId) {
    return this.store.getThread(threadId);
  }
  async setMode(threadId, mode) {
    return this.store.updateThread(threadId, (thread) => {
      thread.settings.mode = mode;
    });
  }
  async setModel(threadId, model) {
    return this.store.updateThread(threadId, (thread) => {
      thread.settings.model = model;
    });
  }
  async attachCurrentNote(threadId) {
    const note = await this.editorTools.getActiveNote();
    if (!note) {
      throw new Error("No active note to attach.");
    }
    const attachment = {
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
  async attachSelection(threadId) {
    const selection = this.editorTools.getSelection();
    if (!selection) {
      throw new Error("No active selection to attach.");
    }
    const selectionAttachment = {
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
    const noteAttachment = {
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
  async toggleAttachment(threadId, attachmentId, included) {
    return this.store.updateThread(threadId, (thread) => {
      const attachment = thread.attachments.find((candidate) => candidate.id === attachmentId);
      if (attachment) {
        attachment.included = included;
      }
    });
  }
  async refreshAttachment(threadId, attachmentId) {
    const thread = await this.requireThread(threadId);
    const attachment = thread.attachments.find((candidate) => candidate.id === attachmentId);
    if (!attachment || !attachment.source.path) {
      return thread;
    }
    const note = await this.vaultTools.readNote(attachment.source.path);
    if (!note) {
      this.logTool(thread, "read_note", { path: attachment.source.path }, false, void 0, "Attachment source note not found");
      await this.store.saveThread(thread);
      return thread;
    }
    attachment.contentSnapshot = note.content;
    attachment.lastRefreshedAt = makeTimestamp();
    this.logTool(thread, "read_note", { path: attachment.source.path }, true, "Refreshed attachment snapshot");
    await this.store.saveThread(thread);
    return thread;
  }
  async sendMessage(threadId, userMessage, options) {
    var _a;
    let working = await this.store.getThread(threadId) || await this.store.createThread(userMessage.slice(0, 40) || "New thread");
    const user = {
      id: makeEntityId("msg"),
      role: "user",
      content: userMessage,
      createdAt: makeTimestamp()
    };
    working.messages.push(user);
    const searchQuery = this.tryExtractSearchQuery(userMessage);
    if (searchQuery) {
      const results = await this.vaultTools.searchNotes(searchQuery, 8);
      const attachment = {
        id: makeEntityId("attachment"),
        type: "search",
        label: `Search: ${searchQuery}`,
        source: { query: searchQuery },
        contentSnapshot: results.map((result2, idx) => `${idx + 1}. ${result2.path}
${result2.snippet}`).join("\n\n"),
        included: true,
        createdAt: makeTimestamp(),
        lastRefreshedAt: makeTimestamp()
      };
      working.attachments.push(attachment);
      this.logTool(working, "search_notes", { query: searchQuery, limit: 8 }, true, `Found ${results.length} results`);
    }
    const attachments = working.attachments.filter((attachment) => attachment.included);
    const modelId = working.settings.model || "mock";
    const model = (_a = this.modelClients.get(modelId)) != null ? _a : this.modelClients.get("mock");
    if (!model) {
      throw new Error("No model clients registered.");
    }
    let result;
    try {
      result = await model.stream(
        {
          thread: working,
          userMessage,
          attachments
        },
        {
          onToken: options == null ? void 0 : options.onToken
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new import_obsidian2.Notice(`Model error: ${message}`);
      this.logTool(working, "model_stream", { model: model.id }, false, void 0, message);
      await this.store.saveThread(working);
      return working;
    }
    const assistant = {
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
  async applyChange(threadId, changeId) {
    const thread = await this.requireThread(threadId);
    const change = thread.proposedChanges.find((candidate) => candidate.id === changeId);
    if (!change) {
      throw new Error("Proposed change not found.");
    }
    if (change.status !== "proposed") {
      return thread;
    }
    if (!this.permissionManager.canWrite(thread.settings.mode)) {
      new import_obsidian2.Notice("Plan mode: writes are disabled.");
      return thread;
    }
    const result = await this.applyEngine.apply(change);
    if (result.ok) {
      change.status = "applied";
      change.appliedAt = makeTimestamp();
      change.error = void 0;
      this.logTool(thread, "apply_change", { path: change.path, action: change.action }, true, "Applied change");
    } else {
      change.error = result.error;
      this.logTool(thread, "apply_change", { path: change.path, action: change.action }, false, void 0, result.error);
      new import_obsidian2.Notice(`Apply failed: ${result.error}`);
    }
    await this.store.saveThread(thread);
    return thread;
  }
  async rejectChange(threadId, changeId) {
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
  async applyAll(threadId) {
    const thread = await this.requireThread(threadId);
    return this.applyAllOnThread(thread);
  }
  async rejectAll(threadId) {
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
  async applyAllOnThread(thread) {
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
        change.error = void 0;
        this.logTool(thread, "apply_change", { path: change.path, action: change.action }, true, "Applied change");
      } else {
        change.error = result.error;
        this.logTool(thread, "apply_change", { path: change.path, action: change.action }, false, void 0, result.error);
      }
    }
    await this.store.saveThread(thread);
    return thread;
  }
  async materializeProposals(inputs, thread) {
    const out = [];
    for (const input of inputs) {
      const baseContent = await this.resolveBaseContent(input, thread);
      const proposedContent = input.content;
      const diff = typeof proposedContent === "string" ? DiffEngine.renderUnified(baseContent, proposedContent) : void 0;
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
  async resolveBaseContent(input, thread) {
    var _a, _b;
    if (input.action === "create") {
      return "";
    }
    const fromPath = input.action === "rename" ? (_a = input.from) != null ? _a : input.path : input.path;
    const note = fromPath ? await this.vaultTools.readNote(fromPath) : null;
    if (note) {
      return note.content;
    }
    const attached = thread.attachments.find((attachment) => attachment.source.path === fromPath);
    return (_b = attached == null ? void 0 : attached.contentSnapshot) != null ? _b : "";
  }
  tryExtractSearchQuery(content) {
    const match = content.match(/find\s+notes\s+about\s+(.+?)(?:\.|$)/i);
    return match ? match[1].trim() : null;
  }
  async requireThread(threadId) {
    const thread = await this.store.getThread(threadId);
    if (!thread) {
      throw new Error("Thread not found.");
    }
    return thread;
  }
  logTool(thread, name, args, success, result, error) {
    const entry = {
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
};

// src/agent/PermissionManager.ts
var PermissionManager = class {
  canWrite(mode) {
    return mode !== "plan";
  }
  needsApproval(mode) {
    return mode === "normal";
  }
  shouldAutoApply(mode) {
    return mode === "auto-apply";
  }
};

// src/diff/ApplyEngine.ts
var import_obsidian3 = require("obsidian");
var ApplyEngine = class {
  constructor(app) {
    this.app = app;
  }
  async apply(change) {
    try {
      if (change.action === "modify") {
        return await this.applyModify(change);
      }
      if (change.action === "create") {
        return await this.applyCreate(change);
      }
      if (change.action === "rename") {
        return await this.applyRename(change);
      }
      return { ok: false, error: `Unsupported change action: ${change.action}` };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  async applyModify(change) {
    const target = this.app.vault.getAbstractFileByPath((0, import_obsidian3.normalizePath)(change.path));
    if (!(target instanceof import_obsidian3.TFile)) {
      return { ok: false, error: `Cannot modify missing file: ${change.path}` };
    }
    if (typeof change.proposedContent !== "string") {
      return { ok: false, error: "Missing proposed content for modify change." };
    }
    await this.app.vault.process(target, (currentContent) => {
      const currentHash = DiffEngine.hashContent(currentContent);
      if (currentHash !== change.baseHash) {
        throw new Error("File changed since proposal was generated.");
      }
      return change.proposedContent;
    });
    return { ok: true };
  }
  async applyCreate(change) {
    if (typeof change.proposedContent !== "string") {
      return { ok: false, error: "Missing proposed content for create change." };
    }
    const path = (0, import_obsidian3.normalizePath)(change.path);
    if (this.app.vault.getAbstractFileByPath(path)) {
      return { ok: false, error: `Cannot create file that exists: ${path}` };
    }
    await this.ensureParentFolder(path);
    await this.app.vault.create(path, change.proposedContent);
    return { ok: true };
  }
  async applyRename(change) {
    if (!change.from || !change.to) {
      return { ok: false, error: "Rename change requires from/to paths." };
    }
    const source = this.app.vault.getAbstractFileByPath((0, import_obsidian3.normalizePath)(change.from));
    if (!(source instanceof import_obsidian3.TFile)) {
      return { ok: false, error: `Cannot rename missing file: ${change.from}` };
    }
    const targetPath = (0, import_obsidian3.normalizePath)(change.to);
    await this.ensureParentFolder(targetPath);
    await this.app.fileManager.renameFile(source, targetPath);
    return { ok: true };
  }
  async ensureParentFolder(path) {
    const parts = path.split("/");
    parts.pop();
    if (parts.length === 0) {
      return;
    }
    const folderPath = (0, import_obsidian3.normalizePath)(parts.join("/"));
    if (await this.app.vault.adapter.exists(folderPath)) {
      return;
    }
    const segments = folderPath.split("/");
    let current = "";
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      if (!await this.app.vault.adapter.exists(current)) {
        await this.app.vault.createFolder(current);
      }
    }
  }
};

// src/model/providers/AnthropicClient.ts
var AnthropicClient = class {
  constructor() {
    this.id = "anthropic";
  }
  async stream(_request, _hooks) {
    throw new Error("Anthropic provider not wired yet. Switch model to mock.");
  }
};

// src/model/providers/MockModelClient.ts
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function toBullets(content) {
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0).slice(0, 5);
  if (lines.length === 0) {
    return "- (No content found)";
  }
  return lines.map((line) => `- ${line}`).join("\n");
}
function rewriteSelection(selected) {
  const trimmed = selected.trim();
  if (!trimmed) {
    return selected;
  }
  return `Rewritten:
${trimmed}`;
}
function findAttachment(attachments, type) {
  return attachments.find((item) => item.type === type && item.included);
}
function sanitizeFileName(name) {
  const cleaned = name.replace(/[^a-z0-9\-\s]/gi, "").trim().replace(/\s+/g, "-").toLowerCase();
  return cleaned || "consolidated-notes";
}
function buildResult(request) {
  const content = request.userMessage.trim();
  const lower = content.toLowerCase();
  const proposals = [];
  const selectionAttachment = findAttachment(request.attachments, "selection");
  const noteAttachment = findAttachment(request.attachments, "note");
  const searchAttachment = findAttachment(request.attachments, "search");
  let assistantText = "I reviewed the request and prepared a response.";
  if (lower.includes("rewrite") && selectionAttachment && noteAttachment && noteAttachment.source.path) {
    const rewritten = rewriteSelection(selectionAttachment.contentSnapshot);
    const originalContent = noteAttachment.contentSnapshot;
    const replaced = originalContent.includes(selectionAttachment.contentSnapshot) ? originalContent.replace(selectionAttachment.contentSnapshot, rewritten) : `${rewritten}

${originalContent}`;
    proposals.push({
      action: "modify",
      path: noteAttachment.source.path,
      content: replaced,
      rationale: "Rewrite selected text in-place."
    });
    assistantText = "I drafted a rewrite for the attached selection and prepared a file change proposal.";
  } else if (lower.includes("summarize") && noteAttachment && noteAttachment.source.path) {
    const bullets = toBullets(noteAttachment.contentSnapshot);
    proposals.push({
      action: "modify",
      path: noteAttachment.source.path,
      content: `## Summary
${bullets}

${noteAttachment.contentSnapshot}`,
      rationale: "Insert summary bullets at the top of the note."
    });
    assistantText = "I created a summary block and prepared an insertion proposal at the top of the note.";
  } else if (lower.includes("consolid") && searchAttachment) {
    const match = lower.match(/about\s+(.+?)(?:\.|$)/i);
    const topic = ((match == null ? void 0 : match[1]) || "topic").trim();
    const fileName = `${sanitizeFileName(topic)}-consolidated.md`;
    proposals.push({
      action: "create",
      path: fileName,
      content: `# Consolidated Notes: ${topic}

${searchAttachment.contentSnapshot}`,
      rationale: "Create a consolidated document from search results."
    });
    assistantText = "I prepared a consolidated note proposal from the search context.";
  } else {
    assistantText = [
      "I can read context, run vault search, and prepare file proposals.",
      "For a concrete edit proposal, try prompts like:",
      "- Rewrite the attached selection",
      "- Summarize the attached note into bullets",
      "- Find notes about X and create a consolidated doc"
    ].join("\n");
  }
  return {
    assistantText,
    proposals
  };
}
var MockModelClient = class {
  constructor() {
    this.id = "mock";
  }
  async stream(request, hooks) {
    var _a;
    const result = buildResult(request);
    let partial = "";
    for (const token of result.assistantText.split(/(\s+)/)) {
      partial += token;
      (_a = hooks == null ? void 0 : hooks.onToken) == null ? void 0 : _a.call(hooks, partial);
      await sleep(16);
    }
    return result;
  }
};

// src/tools/EditorTools.ts
var import_obsidian4 = require("obsidian");
var EditorTools = class {
  constructor(app) {
    this.app = app;
  }
  getSelection() {
    const view = this.app.workspace.getActiveViewOfType(import_obsidian4.MarkdownView);
    if (!view || !view.file) {
      return null;
    }
    const editor = view.editor;
    const selectedText = editor.getSelection();
    if (!selectedText) {
      return null;
    }
    const from = editor.getCursor("from");
    const to = editor.getCursor("to");
    return {
      path: view.file.path,
      selectedText,
      range: {
        from: { line: from.line, ch: from.ch },
        to: { line: to.line, ch: to.ch }
      },
      fullContent: editor.getValue()
    };
  }
  async getActiveNote() {
    const view = this.app.workspace.getActiveViewOfType(import_obsidian4.MarkdownView);
    if (!view || !view.file) {
      return null;
    }
    const content = await this.app.vault.cachedRead(view.file);
    return {
      path: view.file.path,
      content
    };
  }
};

// src/tools/VaultTools.ts
var import_obsidian5 = require("obsidian");
var VaultTools = class {
  constructor(app) {
    this.app = app;
  }
  async readNote(path) {
    const normalized = (0, import_obsidian5.normalizePath)(path);
    const file = this.app.vault.getAbstractFileByPath(normalized);
    if (!(file instanceof import_obsidian5.TFile)) {
      return null;
    }
    return {
      path: normalized,
      content: await this.app.vault.cachedRead(file)
    };
  }
  async searchNotes(query, limit = 10) {
    const needle = query.toLowerCase();
    const files = this.app.vault.getMarkdownFiles();
    const matches = [];
    for (const file of files) {
      const content = await this.app.vault.cachedRead(file);
      const idx = content.toLowerCase().indexOf(needle);
      if (idx < 0) {
        continue;
      }
      const start = Math.max(0, idx - 60);
      const end = Math.min(content.length, idx + query.length + 60);
      const snippet = content.slice(start, end).replace(/\n/g, " ");
      matches.push({
        path: file.path,
        snippet
      });
      if (matches.length >= limit) {
        break;
      }
    }
    return matches;
  }
  async writeNote(path, content) {
    const normalized = (0, import_obsidian5.normalizePath)(path);
    const file = this.app.vault.getAbstractFileByPath(normalized);
    if (file instanceof import_obsidian5.TFile) {
      await this.app.vault.modify(file, content);
      return;
    }
    await this.createNote(normalized, content);
  }
  async createNote(path, content) {
    const normalized = (0, import_obsidian5.normalizePath)(path);
    await this.ensureParentFolder(normalized);
    await this.app.vault.create(normalized, content);
  }
  async renameNote(from, to) {
    const source = this.app.vault.getAbstractFileByPath((0, import_obsidian5.normalizePath)(from));
    if (!(source instanceof import_obsidian5.TFile)) {
      throw new Error(`Cannot rename missing note: ${from}`);
    }
    await this.ensureParentFolder((0, import_obsidian5.normalizePath)(to));
    await this.app.fileManager.renameFile(source, (0, import_obsidian5.normalizePath)(to));
  }
  async listFolder(path) {
    const prefix = (0, import_obsidian5.normalizePath)(path).replace(/\/$/, "");
    const files = this.app.vault.getMarkdownFiles();
    return files.filter((file) => file.path.startsWith(prefix)).map((file) => file.path);
  }
  async ensureParentFolder(path) {
    const parts = path.split("/");
    parts.pop();
    if (parts.length === 0) {
      return;
    }
    const folderPath = (0, import_obsidian5.normalizePath)(parts.join("/"));
    if (await this.app.vault.adapter.exists(folderPath)) {
      return;
    }
    const segments = folderPath.split("/");
    let current = "";
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      if (!await this.app.vault.adapter.exists(current)) {
        await this.app.vault.createFolder(current);
      }
    }
  }
};

// src/views/ClaudePanelView.ts
var import_obsidian6 = require("obsidian");
var CLAUDE_PANEL_VIEW_TYPE = "claude-panel-view";
var ClaudePanelView = class extends import_obsidian6.ItemView {
  constructor(leaf, orchestrator) {
    super(leaf);
    this.threadIndex = [];
    this.currentThread = null;
    this.streamingAssistant = "";
    this.composerEl = null;
    this.orchestrator = orchestrator;
  }
  getViewType() {
    return CLAUDE_PANEL_VIEW_TYPE;
  }
  getDisplayText() {
    return "Claude Panel";
  }
  getIcon() {
    return "bot";
  }
  async onOpen() {
    await this.loadInitialThread();
    this.render();
  }
  async onClose() {
    this.contentEl.empty();
  }
  async createNewThread(title) {
    this.currentThread = await this.orchestrator.createThread(title);
    await this.refreshIndex();
    this.render();
  }
  async attachCurrentNoteFromCommand() {
    if (!this.currentThread) {
      await this.createNewThread();
    }
    if (!this.currentThread) {
      return;
    }
    try {
      this.currentThread = await this.orchestrator.attachCurrentNote(this.currentThread.id);
      this.render();
      new import_obsidian6.Notice("Attached active note.");
    } catch (error) {
      new import_obsidian6.Notice(error instanceof Error ? error.message : String(error));
    }
  }
  async sendSelectionFromCommand() {
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
      new import_obsidian6.Notice(error instanceof Error ? error.message : String(error));
    }
  }
  async focusComposer() {
    var _a;
    if (!this.currentThread) {
      await this.loadInitialThread();
      this.render();
    }
    (_a = this.composerEl) == null ? void 0 : _a.focus();
  }
  async loadInitialThread() {
    await this.refreshIndex();
    if (this.threadIndex.length === 0) {
      this.currentThread = await this.orchestrator.createThread("New thread");
      await this.refreshIndex();
      return;
    }
    const first = this.threadIndex[0];
    this.currentThread = await this.orchestrator.loadThread(first.id);
  }
  async refreshIndex() {
    this.threadIndex = await this.orchestrator.listThreads();
  }
  render() {
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
  renderHeader() {
    const header = this.contentEl.createDiv({ cls: "claude-header" });
    const modeLabel = header.createEl("label", { text: "Mode" });
    const modeSelect = modeLabel.createEl("select");
    ["plan", "normal", "auto-apply"].forEach((mode) => {
      var _a;
      const option = modeSelect.createEl("option", { value: mode, text: mode });
      if (((_a = this.currentThread) == null ? void 0 : _a.settings.mode) === mode) {
        option.selected = true;
      }
    });
    modeSelect.addEventListener("change", async () => {
      if (!this.currentThread) {
        return;
      }
      this.currentThread = await this.orchestrator.setMode(this.currentThread.id, modeSelect.value);
      this.render();
    });
    const modelLabel = header.createEl("label", { text: "Model" });
    const modelSelect = modelLabel.createEl("select");
    ["mock", "anthropic"].forEach((model) => {
      var _a;
      const option = modelSelect.createEl("option", { value: model, text: model });
      if (((_a = this.currentThread) == null ? void 0 : _a.settings.model) === model) {
        option.selected = true;
      }
    });
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
  }
  renderThreads() {
    var _a;
    const section = this.contentEl.createDiv({ cls: "claude-threads" });
    section.createEl("span", { text: "Thread" });
    const select = section.createEl("select");
    for (const thread of this.threadIndex) {
      const option = select.createEl("option", {
        value: thread.id,
        text: `${thread.title} (${new Date(thread.updatedAt).toLocaleString()})`
      });
      if (thread.id === ((_a = this.currentThread) == null ? void 0 : _a.id)) {
        option.selected = true;
      }
    }
    select.addEventListener("change", async () => {
      this.currentThread = await this.orchestrator.loadThread(select.value);
      this.streamingAssistant = "";
      this.render();
    });
  }
  renderTranscript() {
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
  renderAttachments() {
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
      });
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
  renderProposals() {
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
        item.createEl("pre", {
          cls: "claude-diff",
          text: proposal.diff
        });
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
  renderToolLogs() {
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
  renderComposer() {
    const section = this.contentEl.createDiv({ cls: "claude-composer" });
    section.createDiv({ text: "Message" });
    this.composerEl = section.createEl("textarea", {
      attr: { placeholder: "Ask Claude Panel to read/search/propose edits..." }
    });
    const actions = section.createDiv({ cls: "claude-actions" });
    const sendButton = actions.createEl("button", { text: "Send" });
    sendButton.addEventListener("click", async () => {
      var _a, _b;
      const value = (_b = (_a = this.composerEl) == null ? void 0 : _a.value) != null ? _b : "";
      await this.sendComposerMessage(value);
    });
  }
  async sendComposerMessage(content) {
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
};

// src/main.ts
var ClaudePanelPlugin = class extends import_obsidian7.Plugin {
  async onload() {
    this.store = new ThreadStore(this.app);
    await this.store.init();
    const vaultTools = new VaultTools(this.app);
    const editorTools = new EditorTools(this.app);
    const permissionManager = new PermissionManager();
    const applyEngine = new ApplyEngine(this.app);
    this.orchestrator = new AgentOrchestrator({
      store: this.store,
      vaultTools,
      editorTools,
      models: [new MockModelClient(), new AnthropicClient()],
      applyEngine,
      permissionManager
    });
    this.registerView(
      CLAUDE_PANEL_VIEW_TYPE,
      (leaf) => new ClaudePanelView(leaf, this.orchestrator)
    );
    this.addCommand({
      id: "open-claude-panel",
      name: "Open Claude Panel",
      callback: async () => {
        await this.activateView();
      }
    });
    this.addCommand({
      id: "send-selection-to-claude",
      name: "Send Selection to Claude",
      callback: async () => {
        const view = await this.activateView();
        await view.sendSelectionFromCommand();
      }
    });
    this.addCommand({
      id: "attach-current-note-to-claude",
      name: "Attach Current Note",
      callback: async () => {
        const view = await this.activateView();
        await view.attachCurrentNoteFromCommand();
      }
    });
    this.addCommand({
      id: "new-claude-thread",
      name: "New Thread",
      callback: async () => {
        const view = await this.activateView();
        await view.createNewThread();
      }
    });
    this.addCommand({
      id: "dev-seed-demo-thread",
      name: "Dev: seed demo thread",
      callback: async () => {
        const view = await this.activateView();
        await view.createNewThread("Demo thread");
        new import_obsidian7.Notice("Created demo thread.");
      }
    });
  }
  async onunload() {
    await this.app.workspace.getLeavesOfType(CLAUDE_PANEL_VIEW_TYPE).reduce(async (promise, leaf) => {
      await promise;
      await leaf.setViewState({ type: "empty" });
    }, Promise.resolve());
  }
  async activateView() {
    let leaf = this.app.workspace.getLeavesOfType(CLAUDE_PANEL_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      if (!leaf) {
        throw new Error("Unable to create right sidebar leaf.");
      }
      await leaf.setViewState({
        type: CLAUDE_PANEL_VIEW_TYPE,
        active: true
      });
    }
    this.app.workspace.revealLeaf(leaf);
    const view = leaf.view;
    if (!(view instanceof ClaudePanelView)) {
      throw new Error("Claude panel view not found.");
    }
    return view;
  }
};
