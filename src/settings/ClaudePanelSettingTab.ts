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
      .setDesc("Model selected for newly created threads.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("mock", "mock")
          .addOption("anthropic", "anthropic")
          .setValue(this.plugin.settings.defaultThreadModel)
          .onChange(async (value: "mock" | "anthropic") => {
            this.plugin.settings.defaultThreadModel = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Anthropic API key")
      .setDesc("Stored in plugin data inside this vault.")
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("sk-ant-...")
          .setValue(this.plugin.settings.anthropicApiKey)
          .onChange(async (value) => {
            this.plugin.settings.anthropicApiKey = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Anthropic model")
      .setDesc("Used when a thread model is set to anthropic.")
      .addText((text) =>
        text
          .setPlaceholder("claude-3-5-sonnet-latest")
          .setValue(this.plugin.settings.anthropicModel)
          .onChange(async (value) => {
            this.plugin.settings.anthropicModel = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Anthropic max tokens")
      .setDesc("Upper bound for response tokens.")
      .addText((text) =>
        text
          .setPlaceholder("1600")
          .setValue(String(this.plugin.settings.anthropicMaxTokens))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            if (Number.isFinite(parsed) && parsed > 0) {
              this.plugin.settings.anthropicMaxTokens = parsed;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Anthropic temperature")
      .setDesc("Sampling temperature between 0 and 1.")
      .addText((text) =>
        text
          .setPlaceholder("0.2")
          .setValue(String(this.plugin.settings.anthropicTemperature))
          .onChange(async (value) => {
            const parsed = Number.parseFloat(value);
            if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
              this.plugin.settings.anthropicTemperature = parsed;
              await this.plugin.saveSettings();
            }
          })
      );
  }
}
