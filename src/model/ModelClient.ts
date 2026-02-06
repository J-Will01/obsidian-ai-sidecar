import { Attachment, ModelResult, Thread } from "../state/types";

export interface ModelRequest {
  thread: Thread;
  userMessage: string;
  attachments: Attachment[];
}

export interface ModelStreamHooks {
  onToken?: (partial: string) => void;
}

export interface ModelClient {
  readonly id: string;
  stream(request: ModelRequest, hooks?: ModelStreamHooks): Promise<ModelResult>;
}
