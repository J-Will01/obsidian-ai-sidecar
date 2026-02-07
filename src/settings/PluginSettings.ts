export interface ClaudePanelSettings {
  defaultThreadModel: "mock" | "anthropic";
  anthropicApiKey: string;
  anthropicModel: string;
  anthropicMaxTokens: number;
  anthropicTemperature: number;
}

export const DEFAULT_SETTINGS: ClaudePanelSettings = {
  defaultThreadModel: "mock",
  anthropicApiKey: "",
  anthropicModel: "claude-3-5-sonnet-latest",
  anthropicMaxTokens: 1600,
  anthropicTemperature: 0.2
};
