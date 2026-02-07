import { App, PluginSettingTab, Setting } from "obsidian";
import ClaudePanelPlugin from "../main";

export class ClaudePanelSettingTab extends PluginSettingTab {
  plugin: ClaudePanelPlugin;

  constructor(app: App, plugin: ClaudePanelPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Claude Panel" });

    new Setting(containerEl)
      .setName("Default thread model")
      .setDesc("Current runtime backend.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("claude-code", "claude-code")
          .setValue(this.plugin.settings.defaultThreadModel)
          .onChange(async (value: "claude-code") => {
            this.plugin.settings.defaultThreadModel = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Claude executable")
      .setDesc("Path or command name for Claude Code CLI.")
      .addText((text) =>
        text
          .setPlaceholder("claude")
          .setValue(this.plugin.settings.claudeCodeExecutable)
          .onChange(async (value) => {
            this.plugin.settings.claudeCodeExecutable = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Claude model")
      .setDesc("Example: sonnet, opus, or a concrete Claude model name.")
      .addText((text) =>
        text
          .setPlaceholder("sonnet")
          .setValue(this.plugin.settings.claudeCodeModel)
          .onChange(async (value) => {
            this.plugin.settings.claudeCodeModel = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Claude max turns")
      .setDesc("Maximum turns per Claude runtime invocation.")
      .addText((text) =>
        text
          .setPlaceholder("8")
          .setValue(String(this.plugin.settings.claudeCodeMaxTurns))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            if (Number.isFinite(parsed) && parsed > 0) {
              this.plugin.settings.claudeCodeMaxTurns = parsed;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Append system prompt")
      .setDesc("Extra instruction passed to Claude CLI via --append-system-prompt.")
      .addText((text) =>
        text
          .setPlaceholder("Return strict JSON...")
          .setValue(this.plugin.settings.claudeCodeAppendSystemPrompt)
          .onChange(async (value) => {
            this.plugin.settings.claudeCodeAppendSystemPrompt = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Extra CLI args")
      .setDesc("Optional extra args appended to Claude command.")
      .addText((text) =>
        text
          .setPlaceholder("--allowedTools Edit,Read")
          .setValue(this.plugin.settings.claudeCodeExtraArgs)
          .onChange(async (value) => {
            this.plugin.settings.claudeCodeExtraArgs = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
