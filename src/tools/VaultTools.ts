import { App, TFile, normalizePath } from "obsidian";

export interface SearchResult {
  path: string;
  snippet: string;
}

export interface ClaudeWorkspaceBootstrapResult {
  created: string[];
  existing: string[];
}

export class VaultTools {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  async readNote(path: string): Promise<{ path: string; content: string } | null> {
    const normalized = normalizePath(path);
    const file = this.app.vault.getAbstractFileByPath(normalized);
    if (!(file instanceof TFile)) {
      return null;
    }

    return {
      path: normalized,
      content: await this.app.vault.cachedRead(file)
    };
  }

  async searchNotes(query: string, limit = 10): Promise<SearchResult[]> {
    const needle = query.toLowerCase();
    const files = this.app.vault.getMarkdownFiles();
    const matches: SearchResult[] = [];

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

  async writeNote(path: string, content: string): Promise<void> {
    const normalized = normalizePath(path);
    const file = this.app.vault.getAbstractFileByPath(normalized);

    if (file instanceof TFile) {
      await this.app.vault.modify(file, content);
      return;
    }

    await this.createNote(normalized, content);
  }

  async createNote(path: string, content: string): Promise<void> {
    const normalized = normalizePath(path);
    await this.ensureParentFolder(normalized);
    await this.app.vault.create(normalized, content);
  }

  async renameNote(from: string, to: string): Promise<void> {
    const source = this.app.vault.getAbstractFileByPath(normalizePath(from));
    if (!(source instanceof TFile)) {
      throw new Error(`Cannot rename missing note: ${from}`);
    }

    await this.ensureParentFolder(normalizePath(to));
    await this.app.fileManager.renameFile(source, normalizePath(to));
  }

  async listFolder(path: string): Promise<string[]> {
    const prefix = normalizePath(path).replace(/\/$/, "");
    const files = this.app.vault.getMarkdownFiles();
    return files.filter((file) => file.path.startsWith(prefix)).map((file) => file.path);
  }

  async ensureClaudeWorkspaceFiles(): Promise<ClaudeWorkspaceBootstrapResult> {
    const created: string[] = [];
    const existing: string[] = [];
    const runtimeDir = normalizePath(".claude");
    const memoryPath = normalizePath("CLAUDE.md");

    if (!(await this.app.vault.adapter.exists(runtimeDir))) {
      await this.app.vault.createFolder(runtimeDir);
      created.push(runtimeDir);
    } else {
      existing.push(runtimeDir);
    }

    const memoryFile = this.app.vault.getAbstractFileByPath(memoryPath);
    if (!(memoryFile instanceof TFile)) {
      const template = [
        "# CLAUDE.md",
        "",
        "Project memory for Claude Code runtime in this Obsidian vault.",
        "",
        "## Goals",
        "- Keep proposed edits reviewable in Claude Panel before applying.",
        "- Prefer incremental changes with clear rationale.",
        "",
        "## Notes",
        "- Use Plan mode for read-only exploration.",
        "- Use Normal mode for approval-based writes."
      ].join("\n");
      await this.app.vault.create(memoryPath, template);
      created.push(memoryPath);
    } else {
      existing.push(memoryPath);
    }

    return { created, existing };
  }

  private async ensureParentFolder(path: string): Promise<void> {
    const parts = path.split("/");
    parts.pop();
    if (parts.length === 0) {
      return;
    }

    const folderPath = normalizePath(parts.join("/"));
    if (await this.app.vault.adapter.exists(folderPath)) {
      return;
    }

    const segments = folderPath.split("/");
    let current = "";
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      if (!(await this.app.vault.adapter.exists(current))) {
        await this.app.vault.createFolder(current);
      }
    }
  }
}
