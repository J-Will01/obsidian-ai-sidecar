import { App, normalizePath } from "obsidian";
import { Thread, ThreadIndex, ThreadIndexEntry, ThreadSettings } from "./types";

const ROOT_DIR = ".claude-panel";
const THREADS_DIR = normalizePath(`${ROOT_DIR}/threads`);
const INDEX_PATH = normalizePath(`${ROOT_DIR}/index.json`);

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function defaultThread(title?: string, settings?: Partial<ThreadSettings>): Thread {
  const stamp = nowIso();
  return {
    id: makeId("thread"),
    title: title?.trim() || "New thread",
    createdAt: stamp,
    updatedAt: stamp,
    messages: [],
    attachments: [],
    proposedChanges: [],
    toolLogs: [],
    settings: {
      mode: "normal",
      model: settings?.model ?? "mock"
    }
  };
}

export class ThreadStore {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  async init(): Promise<void> {
    await this.ensureFolder(ROOT_DIR);
    await this.ensureFolder(THREADS_DIR);

    if (!(await this.app.vault.adapter.exists(INDEX_PATH))) {
      const initial: ThreadIndex = { threads: [] };
      await this.app.vault.adapter.write(INDEX_PATH, JSON.stringify(initial, null, 2));
    }
  }

  async listThreads(): Promise<ThreadIndexEntry[]> {
    const index = await this.readIndex();
    return [...index.threads].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async createThread(title?: string, settings?: Partial<ThreadSettings>): Promise<Thread> {
    const thread = defaultThread(title, settings);
    await this.saveThread(thread);
    return thread;
  }

  async getThread(threadId: string): Promise<Thread | null> {
    const path = this.threadPath(threadId);
    if (!(await this.app.vault.adapter.exists(path))) {
      return null;
    }

    try {
      const raw = await this.app.vault.adapter.read(path);
      return JSON.parse(raw) as Thread;
    } catch {
      return null;
    }
  }

  async saveThread(thread: Thread): Promise<void> {
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

  async updateThread(threadId: string, mutate: (thread: Thread) => void): Promise<Thread> {
    const thread = await this.getThread(threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }
    mutate(thread);
    await this.saveThread(thread);
    return thread;
  }

  private async ensureFolder(path: string): Promise<void> {
    const normalized = normalizePath(path);
    if (await this.app.vault.adapter.exists(normalized)) {
      return;
    }
    await this.app.vault.adapter.mkdir(normalized);
  }

  private threadPath(threadId: string): string {
    return normalizePath(`${THREADS_DIR}/${threadId}.json`);
  }

  private async readIndex(): Promise<ThreadIndex> {
    try {
      const raw = await this.app.vault.adapter.read(INDEX_PATH);
      const parsed = JSON.parse(raw) as ThreadIndex;
      if (!Array.isArray(parsed.threads)) {
        return { threads: [] };
      }
      return parsed;
    } catch {
      return { threads: [] };
    }
  }

  private async upsertIndexEntry(entry: ThreadIndexEntry): Promise<void> {
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
}

export function makeEntityId(prefix: string): string {
  return makeId(prefix);
}

export function makeTimestamp(): string {
  return nowIso();
}
