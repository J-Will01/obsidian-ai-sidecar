export type MessageRole = "user" | "assistant" | "tool" | "system";
export type AttachmentType = "selection" | "note" | "search";
export type AgentMode = "plan" | "normal" | "auto-apply";
export type ChangeAction = "modify" | "create" | "rename";

export interface AttachmentRange {
  from: { line: number; ch: number };
  to: { line: number; ch: number };
}

export interface AttachmentSource {
  path?: string;
  range?: AttachmentRange;
  query?: string;
}

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  toolCall?: Record<string, unknown>;
  toolResult?: Record<string, unknown>;
  createdAt: string;
}

export interface Attachment {
  id: string;
  type: AttachmentType;
  label: string;
  source: AttachmentSource;
  contentSnapshot: string;
  included: boolean;
  createdAt: string;
  lastRefreshedAt: string;
}

export interface ProposedChange {
  id: string;
  action: ChangeAction;
  path: string;
  from?: string;
  to?: string;
  baseHash: string;
  proposedContent?: string;
  status: "proposed" | "applied" | "rejected";
  diff?: string;
  rationale?: string;
  createdAt: string;
  appliedAt?: string;
  rejectedAt?: string;
  error?: string;
}

export interface ThreadSettings {
  mode: AgentMode;
  model: string;
}

export interface ToolLogEntry {
  id: string;
  name: string;
  args: Record<string, unknown>;
  success: boolean;
  result?: string;
  error?: string;
  createdAt: string;
}

export interface Thread {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  claudeCodeSessionId?: string;
  claudeCodeSessionUpdatedAt?: string;
  messages: Message[];
  attachments: Attachment[];
  proposedChanges: ProposedChange[];
  toolLogs: ToolLogEntry[];
  settings: ThreadSettings;
}

export interface ThreadIndexEntry {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ThreadIndex {
  threads: ThreadIndexEntry[];
}

export interface ProposedChangeInput {
  action: ChangeAction;
  path: string;
  from?: string;
  to?: string;
  content?: string;
  rationale?: string;
}

export interface ModelResult {
  assistantText: string;
  proposals: ProposedChangeInput[];
  claudeCodeSessionId?: string;
}
