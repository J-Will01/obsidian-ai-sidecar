import { App, MarkdownView } from "obsidian";
import { AttachmentRange } from "../state/types";

export interface SelectionResult {
  path: string;
  selectedText: string;
  range: AttachmentRange;
  fullContent: string;
}

export interface ActiveNoteResult {
  path: string;
  content: string;
}

export class EditorTools {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  getSelection(): SelectionResult | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
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

  async getActiveNote(): Promise<ActiveNoteResult | null> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.file) {
      return null;
    }

    const content = await this.app.vault.cachedRead(view.file);
    return {
      path: view.file.path,
      content
    };
  }
}
