import { Attachment, ModelResult, Thread } from "../state/types";

export interface ModelRequest {
  thread: Thread;
  userMessage: string;
  attachments: Attachment[];
}

export interface ModelStreamHooks {
  onToken?: (partial: string) => void;
}

export interface RuntimeSetupCommand {
  id: string;
  label: string;
  command: string;
  description: string;
}

export interface RuntimeSetupInfo {
  runtimeName: string;
  executable: string;
  cwd: string;
  commands: RuntimeSetupCommand[];
  supportsTerminalLaunch: boolean;
}

export interface RuntimeDiagnosticEntry {
  id: string;
  label: string;
  command: string;
  success: boolean;
  output: string;
}

export interface RuntimeDiagnosticsResult {
  success: boolean;
  summary: string;
  entries: RuntimeDiagnosticEntry[];
}

export interface RuntimeTerminalLaunchResult {
  ok: boolean;
  message: string;
}

export interface ModelClient {
  readonly id: string;
  stream(request: ModelRequest, hooks?: ModelStreamHooks): Promise<ModelResult>;
  getRuntimeSetupInfo?(): RuntimeSetupInfo;
  runRuntimeDiagnostics?(): Promise<RuntimeDiagnosticsResult>;
  launchRuntimeTerminal?(commandId: string): Promise<RuntimeTerminalLaunchResult>;
}
