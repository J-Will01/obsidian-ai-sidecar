export interface ClaudePanelSettings {
  defaultThreadModel: "claude-code";
  claudeCodeLaunchCommand: string;
  claudeCodeExecutable: string;
  claudeCodeWorkingDirectory: string;
  claudeCodeModel: string;
  claudeCodeMaxTurns: number;
  claudeCodeAppendSystemPrompt: string;
  claudeCodeExtraArgs: string;
}

export const DEFAULT_SETTINGS: ClaudePanelSettings = {
  defaultThreadModel: "claude-code",
  claudeCodeLaunchCommand: "claude",
  claudeCodeExecutable: "claude",
  claudeCodeWorkingDirectory: "",
  claudeCodeModel: "sonnet",
  claudeCodeMaxTurns: 8,
  claudeCodeAppendSystemPrompt:
    "Return strict JSON only: {\"assistantText\": string, \"proposals\": [{\"action\":\"modify|create|rename\",\"path\":string,\"content\"?:string,\"from\"?:string,\"to\"?:string,\"rationale\"?:string}]}.",
  claudeCodeExtraArgs: ""
};
