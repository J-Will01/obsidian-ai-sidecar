import { requestUrl } from "obsidian";
import { ModelClient, ModelRequest, ModelStreamHooks } from "../ModelClient";
import { ModelResult, ProposedChangeInput } from "../../state/types";

interface AnthropicConfig {
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
}

type GetAnthropicConfig = () => AnthropicConfig;

const SYSTEM_PROMPT = [
  "You are an Obsidian assistant that must return strict JSON only.",
  "Never wrap output in markdown or prose around the JSON object.",
  "JSON shape:",
  '{ "assistantText": "string", "proposals": [ { "action": "modify|create|rename", "path": "string", "content"?: "string", "from"?: "string", "to"?: "string", "rationale"?: "string" } ] }',
  "Rules:",
  "- Only include proposals when a file change is needed.",
  "- For modify/create, include full file content in content.",
  "- For rename, include from and to."
].join("\n");

function formatRequestInput(request: ModelRequest): string {
  const attachments = request.attachments
    .map((attachment, index) => {
      const source = attachment.source.path || attachment.source.query || "unknown";
      const snapshot = attachment.contentSnapshot.slice(0, 12000);
      return `Attachment ${index + 1}\nType: ${attachment.type}\nSource: ${source}\nContent:\n${snapshot}`;
    })
    .join("\n\n---\n\n");

  return [
    `User message:\n${request.userMessage}`,
    attachments ? `\nAttached context:\n${attachments}` : ""
  ].join("\n");
}

function extractTextContent(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const content = (payload as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .filter((item) => item && typeof item === "object" && (item as { type?: unknown }).type === "text")
    .map((item) => String((item as { text?: unknown }).text ?? ""))
    .join("\n")
    .trim();
}

function parseJsonObject(rawText: string): Record<string, unknown> | null {
  const direct = rawText.trim();
  if (!direct) {
    return null;
  }

  try {
    return JSON.parse(direct) as Record<string, unknown>;
  } catch {
    // fall through
  }

  const fenced = direct.match(/```json\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1]) as Record<string, unknown>;
    } catch {
      // fall through
    }
  }

  const start = direct.indexOf("{");
  const end = direct.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(direct.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  return null;
}

function parseProposals(value: unknown): ProposedChangeInput[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const action = String((item as { action?: unknown }).action ?? "");
      const path = String((item as { path?: unknown }).path ?? "");
      if (!path || !["modify", "create", "rename"].includes(action)) {
        return null;
      }

      return {
        action: action as ProposedChangeInput["action"],
        path,
        content: typeof (item as { content?: unknown }).content === "string" ? String((item as { content?: unknown }).content) : undefined,
        from: typeof (item as { from?: unknown }).from === "string" ? String((item as { from?: unknown }).from) : undefined,
        to: typeof (item as { to?: unknown }).to === "string" ? String((item as { to?: unknown }).to) : undefined,
        rationale:
          typeof (item as { rationale?: unknown }).rationale === "string"
            ? String((item as { rationale?: unknown }).rationale)
            : undefined
      } as ProposedChangeInput;
    })
    .filter((item): item is ProposedChangeInput => item !== null);
}

function parseModelResult(rawText: string): ModelResult {
  const parsed = parseJsonObject(rawText);
  if (!parsed) {
    return {
      assistantText: rawText,
      proposals: []
    };
  }

  const assistantText =
    typeof parsed.assistantText === "string" && parsed.assistantText.trim()
      ? parsed.assistantText
      : "Model response parsed, but assistantText was empty.";

  return {
    assistantText,
    proposals: parseProposals(parsed.proposals)
  };
}

export class AnthropicClient implements ModelClient {
  readonly id = "anthropic";
  private getConfig: GetAnthropicConfig;

  constructor(getConfig: GetAnthropicConfig) {
    this.getConfig = getConfig;
  }

  async stream(request: ModelRequest, hooks?: ModelStreamHooks): Promise<ModelResult> {
    const config = this.getConfig();
    if (!config.apiKey) {
      throw new Error("Anthropic API key is missing. Set it in plugin settings.");
    }

    const response = await requestUrl({
      url: "https://api.anthropic.com/v1/messages",
      method: "POST",
      headers: {
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: config.maxTokens,
        temperature: config.temperature,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: formatRequestInput(request)
          }
        ]
      }),
      throw: false
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Anthropic request failed (${response.status}): ${response.text}`);
    }

    const rawText = extractTextContent(response.json);
    const parsed = parseModelResult(rawText);

    let streaming = "";
    for (const piece of parsed.assistantText.split(/(\s+)/)) {
      streaming += piece;
      hooks?.onToken?.(streaming);
    }

    return parsed;
  }
}
