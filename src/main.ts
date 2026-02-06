import { Notice, Plugin } from "obsidian";
import { AgentOrchestrator } from "./agent/AgentOrchestrator";
import { PermissionManager } from "./agent/PermissionManager";
import { ApplyEngine } from "./diff/ApplyEngine";
import { AnthropicClient } from "./model/providers/AnthropicClient";
import { MockModelClient } from "./model/providers/MockModelClient";
import { ThreadStore } from "./state/ThreadStore";
import { EditorTools } from "./tools/EditorTools";
import { VaultTools } from "./tools/VaultTools";
import { CLAUDE_PANEL_VIEW_TYPE, ClaudePanelView } from "./views/ClaudePanelView";

export default class ClaudePanelPlugin extends Plugin {
  private store!: ThreadStore;
  private orchestrator!: AgentOrchestrator;

  async onload(): Promise<void> {
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
        new Notice("Created demo thread.");
      }
    });
  }

  async onunload(): Promise<void> {
    await this.app.workspace
      .getLeavesOfType(CLAUDE_PANEL_VIEW_TYPE)
      .reduce(async (promise, leaf) => {
        await promise;
        await leaf.setViewState({ type: "empty" });
      }, Promise.resolve());
  }

  private async activateView(): Promise<ClaudePanelView> {
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
}
