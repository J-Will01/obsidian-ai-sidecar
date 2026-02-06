import { ModelClient, ModelRequest, ModelStreamHooks } from "../ModelClient";
import { ModelResult } from "../../state/types";

export class AnthropicClient implements ModelClient {
  readonly id = "anthropic";

  async stream(_request: ModelRequest, _hooks?: ModelStreamHooks): Promise<ModelResult> {
    throw new Error("Anthropic provider not wired yet. Switch model to mock.");
  }
}
