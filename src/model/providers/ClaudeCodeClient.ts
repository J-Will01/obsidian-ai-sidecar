import { spawn } from "child_process";
import { accessSync, constants } from "fs";
import { isAbsolute, join, resolve } from "path";
import { ModelClient, ModelRequest, ModelStreamHooks } from "../ModelClient";
import { ModelResult, ProposedChangeInput } from "../../state/types";

interface ClaudeCodeConfig {
  executable: string;
  model: string;
  maxTurns: number;
  appendSystemPrompt: string;
  extraArgs: string;
  cwd: string;
}

type GetClaudeCodeConfig = () => ClaudeCodeConfig;

function canExecute(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveExecutable(executable: string, cwd: string): { command: string | null; tried: string[] } {
  const trimmed = executable.trim();
  if (!trimmed) {
    return { command: null, tried: [] };
  }

  if (trimmed.includes("/")) {
    const candidate = isAbsolute(trimmed) ? trimmed : resolve(cwd, trimmed);
    return canExecute(candidate)
      ? { command: candidate, tried: [candidate] }
      : { command: null, tried: [candidate] };
  }

  const pathEntries = (process.env.PATH || "")
    .split(":")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const fallbackEntries = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];
  const directories = [...new Set([...pathEntries, ...fallbackEntries])];
  const tried: string[] = [];

  for (const dir of directories) {
    const candidate = join(dir, trimmed);
    tried.push(candidate);
    if (canExecute(candidate)) {
      return { command: candidate, tried };
    }
  }

  return { command: null, tried };
}

function splitArgs(input: string): string[] {
  return input
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function extractTextFromAssistantPayload(payload: Record<string, unknown>): string {
  const message = payload.message as Record<string, unknown> | undefined;
  const container = message ?? payload;
  const content = container.content;
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
        content:
          typeof (item as { content?: unknown }).content === "string"
            ? String((item as { content?: unknown }).content)
            : undefined,
        from:
          typeof (item as { from?: unknown }).from === "string"
            ? String((item as { from?: unknown }).from)
            : undefined,
        to:
          typeof (item as { to?: unknown }).to === "string"
            ? String((item as { to?: unknown }).to)
            : undefined,
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
      : "Claude Code returned JSON with no assistantText.";

  return {
    assistantText,
    proposals: parseProposals(parsed.proposals)
  };
}

function formatUserPrompt(request: ModelRequest): string {
  const attachments = request.attachments
    .map((attachment, index) => {
      const source = attachment.source.path || attachment.source.query || "unknown";
      const snapshot = attachment.contentSnapshot.slice(0, 12000);
      return [
        `Attachment ${index + 1}`,
        `Type: ${attachment.type}`,
        `Source: ${source}`,
        "Content:",
        snapshot
      ].join("\n");
    })
    .join("\n\n---\n\n");

  return [
    "Task:",
    request.userMessage,
    attachments ? `\nAttached context:\n${attachments}` : ""
  ].join("\n");
}

function mapPermissionMode(mode: string): string {
  if (mode === "plan") {
    return "plan";
  }
  if (mode === "auto-apply") {
    return "acceptEdits";
  }
  return "default";
}

export class ClaudeCodeClient implements ModelClient {
  readonly id = "claude-code";
  private getConfig: GetClaudeCodeConfig;

  constructor(getConfig: GetClaudeCodeConfig) {
    this.getConfig = getConfig;
  }

  async stream(request: ModelRequest, hooks?: ModelStreamHooks): Promise<ModelResult> {
    const config = this.getConfig();
    const resolved = resolveExecutable(config.executable, config.cwd);
    if (!resolved.command) {
      throw new Error(
        [
          `Claude executable not found: ${config.executable}`,
          resolved.tried.length ? `Tried:\n- ${resolved.tried.join("\n- ")}` : "No executable candidates were generated.",
          "Set Settings -> Claude Panel -> Claude executable to an absolute path."
        ].join("\n\n")
      );
    }

    const args: string[] = [
      "-p",
      formatUserPrompt(request),
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      mapPermissionMode(request.thread.settings.mode),
      "--max-turns",
      String(config.maxTurns)
    ];

    if (config.model.trim()) {
      args.push("--model", config.model.trim());
    }

    if (config.appendSystemPrompt.trim()) {
      args.push("--append-system-prompt", config.appendSystemPrompt.trim());
    }

    if (request.thread.claudeCodeSessionId) {
      args.push("--resume", request.thread.claudeCodeSessionId);
    }

    args.push(...splitArgs(config.extraArgs));

    const streamedAssistantChunks: string[] = [];
    const rawStdoutChunks: string[] = [];
    const rawStderrChunks: string[] = [];
    let finalResultText = "";
    let resultErrorText = "";
    let sessionId: string | undefined;

    await new Promise<void>((resolve, reject) => {
      const child = spawn(resolved.command as string, args, {
        cwd: config.cwd,
        env: process.env
      });

      let lineBuffer = "";

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");

      child.stdout.on("data", (chunk: string) => {
        rawStdoutChunks.push(chunk);
        lineBuffer += chunk;

        let newLine = lineBuffer.indexOf("\n");
        while (newLine >= 0) {
          const line = lineBuffer.slice(0, newLine).trim();
          lineBuffer = lineBuffer.slice(newLine + 1);

          if (line) {
            try {
              const event = JSON.parse(line) as Record<string, unknown>;
              const type = String(event.type ?? "");
              if (typeof event.session_id === "string" && event.session_id.trim()) {
                sessionId = event.session_id.trim();
              }
              if (type === "assistant") {
                const assistantText = extractTextFromAssistantPayload(event);
                if (assistantText) {
                  streamedAssistantChunks.push(assistantText);
                  hooks?.onToken?.(streamedAssistantChunks.join("\n\n"));
                }
              }
              if (type === "result" && typeof event.result === "string") {
                finalResultText = String(event.result);
                hooks?.onToken?.(finalResultText);
                if (event.is_error === true) {
                  resultErrorText = finalResultText;
                }
              }
            } catch {
              // ignore non-json lines in stream-json mode
            }
          }

          newLine = lineBuffer.indexOf("\n");
        }
      });

      child.stderr.on("data", (chunk: string) => {
        rawStderrChunks.push(chunk);
      });

      child.on("error", (error) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          reject(
            new Error(
              [
                `Claude executable not found: ${config.executable}`,
                `Resolved command: ${resolved.command ?? "none"}`,
                "Set Settings -> Claude Panel -> Claude executable to an absolute path."
              ].join("\n")
            )
          );
          return;
        }
        reject(error);
      });

      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(rawStderrChunks.join("").trim() || `Claude CLI exited with code ${code}`));
          return;
        }

        if (lineBuffer.trim()) {
          rawStdoutChunks.push(lineBuffer);
        }

        resolve();
      });
    });

    const candidate = (finalResultText || streamedAssistantChunks.join("\n\n")).trim();
    if (resultErrorText) {
      throw new Error(resultErrorText);
    }

    if (candidate) {
      const parsed = parseModelResult(candidate);
      parsed.claudeCodeSessionId = sessionId;
      return parsed;
    }

    const parsed = parseModelResult(rawStdoutChunks.join("\n").trim());
    parsed.claudeCodeSessionId = sessionId;
    return parsed;
  }
}
