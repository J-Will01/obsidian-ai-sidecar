import { App, TFile, normalizePath } from "obsidian";
import { ProposedChange } from "../state/types";
import { DiffEngine } from "./DiffEngine";

export interface ApplyResult {
  ok: boolean;
  error?: string;
}

export class ApplyEngine {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  async apply(change: ProposedChange): Promise<ApplyResult> {
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

  private async applyModify(change: ProposedChange): Promise<ApplyResult> {
    const target = this.app.vault.getAbstractFileByPath(normalizePath(change.path));
    if (!(target instanceof TFile)) {
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
      return change.proposedContent as string;
    });

    return { ok: true };
  }

  private async applyCreate(change: ProposedChange): Promise<ApplyResult> {
    if (typeof change.proposedContent !== "string") {
      return { ok: false, error: "Missing proposed content for create change." };
    }

    const path = normalizePath(change.path);
    if (this.app.vault.getAbstractFileByPath(path)) {
      return { ok: false, error: `Cannot create file that exists: ${path}` };
    }

    await this.ensureParentFolder(path);
    await this.app.vault.create(path, change.proposedContent);
    return { ok: true };
  }

  private async applyRename(change: ProposedChange): Promise<ApplyResult> {
    if (!change.from || !change.to) {
      return { ok: false, error: "Rename change requires from/to paths." };
    }

    const source = this.app.vault.getAbstractFileByPath(normalizePath(change.from));
    if (!(source instanceof TFile)) {
      return { ok: false, error: `Cannot rename missing file: ${change.from}` };
    }

    const targetPath = normalizePath(change.to);
    await this.ensureParentFolder(targetPath);
    await this.app.fileManager.renameFile(source, targetPath);
    return { ok: true };
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
