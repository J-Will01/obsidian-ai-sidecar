import { spawn } from "child_process";
import { accessSync, constants } from "fs";
import { isAbsolute, join, resolve } from "path";
import {
  ModelClient,
  ModelRequest,
  ModelStreamHooks,
  RuntimeDiagnosticEntry,
  RuntimeDiagnosticsResult,
  RuntimeSetupCommand,
  RuntimeSetupInfo,
  RuntimeTerminalLaunchResult
} from "../ModelClient";
import { ModelResult, ProposedChangeInput } from "../../state/types";

interface ClaudeCodeConfig {
  launchCommand: string;
  executable: string;
  configuredWorkingDirectory: string;
  model: string;
  maxTurns: number;
  appendSystemPrompt: string;
  extraArgs: string;
  cwd: string;
}

interface CommandExecutionResult {
  command: string;
  success: boolean;
  output: string;
}

interface RuntimeInvocation {
  mode: "direct" | "shell";
  command: string;
  args: string[];
  shellScript?: string;
}

type GetClaudeCodeConfig = () => ClaudeCodeConfig;

const DIAGNOSTIC_TIMEOUT_MS = 20000;
const STATUS_DIAGNOSTIC_TIMEOUT_MS = 60000;

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

function firstCommandToken(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) {
    return "claude";
  }
  const [first] = trimmed.split(/\s+/);
  return first || "claude";
}

function shellQuote(input: string): string {
  if (!input) {
    return "''";
  }
  return `'${input.replace(/'/g, `'\"'\"'`)}'`;
}

function formatCommand(command: string, args: string[]): string {
  const full = [command, ...args];
  return full.map((part) => shellQuote(part)).join(" ");
}

function formatLaunchCommand(prefix: string, args: string[]): string {
  const trimmed = prefix.trim();
  const suffix = args.map((arg) => shellQuote(arg)).join(" ");
  if (!trimmed) {
    return suffix;
  }
  if (!suffix) {
    return trimmed;
  }
  return `${trimmed} ${suffix}`;
}

function makeRuntimeCommands(command: string): RuntimeSetupCommand[] {
  const statusArgs = [
    "-p",
    "/status",
    "--output-format",
    "text",
    "--verbose",
    "--permission-mode",
    "plan",
    "--max-turns",
    "1"
  ];

  const locateToken = firstCommandToken(command);
  const locateCommand = locateToken.includes("/")
    ? `ls -l ${shellQuote(locateToken)}`
    : `command -v ${shellQuote(locateToken)}`;

  return [
    {
      id: "where",
      label: "Locate Claude",
      command: locateCommand,
      description: "Confirms where the Claude executable resolves in your shell."
    },
    {
      id: "version",
      label: "Check version",
      command: formatLaunchCommand(command, ["--version"]),
      description: "Verifies the Claude CLI launches from Obsidian."
    },
    {
      id: "status",
      label: "Probe /status",
      command: formatLaunchCommand(command, statusArgs),
      description: "Runs a non-editing one-shot request to validate auth/runtime."
    },
    {
      id: "login",
      label: "Open login shell",
      command: formatLaunchCommand(command, []),
      description: "Starts interactive Claude CLI. If needed, run /login."
    }
  ];
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

  getRuntimeSetupInfo(): RuntimeSetupInfo {
    const config = this.getConfig();
    const command = this.resolveSetupCommand(config);

    return {
      runtimeName: "Claude Code CLI",
      executable: command,
      cwd: config.cwd,
      commands: makeRuntimeCommands(command),
      supportsTerminalLaunch: process.platform === "darwin"
    };
  }

  async runRuntimeDiagnostics(): Promise<RuntimeDiagnosticsResult> {
    const config = this.getConfig();
    const launchCommand = this.resolveSetupCommand(config);
    const entries: RuntimeDiagnosticEntry[] = [];
    const prefix = config.launchCommand.trim();
    if (prefix) {
      entries.push({
        id: "resolve",
        label: "Resolve launch command",
        command: prefix,
        success: true,
        output: `Using shell launch command: ${prefix}`
      });
    } else {
      const resolved = resolveExecutable(config.executable, config.cwd);
      entries.push({
        id: "resolve",
        label: "Resolve executable",
        command: config.executable,
        success: !!resolved.command,
        output: resolved.command
          ? `Resolved: ${resolved.command}`
          : [
              `Claude executable not found: ${config.executable}`,
              resolved.tried.length ? `Tried:\n- ${resolved.tried.join("\n- ")}` : "No candidates were generated."
            ].join("\n")
      });
      if (!resolved.command) {
        return {
          success: false,
          summary: "Executable resolution failed. Set a launch command or an absolute Claude executable path in plugin settings.",
          entries
        };
      }
    }

    const checks: Array<{ id: string; label: string; args: string[] }> = [
      {
        id: "version",
        label: "Check version",
        args: ["--version"]
      },
      {
        id: "status",
        label: "Probe /status",
        args: ["-p", "/status", "--output-format", "text", "--verbose", "--permission-mode", "plan", "--max-turns", "1"]
      }
    ];

    for (const check of checks) {
      const invocation = this.buildRuntimeInvocation(config, check.args);
      if (invocation.resolveError) {
        entries.push({
          id: check.id,
          label: check.label,
          command: launchCommand,
          success: false,
          output: invocation.resolveError
        });
        continue;
      }

      const timeout = check.id === "status" ? STATUS_DIAGNOSTIC_TIMEOUT_MS : DIAGNOSTIC_TIMEOUT_MS;
      const executed = await this.runCommand(invocation.invocation, timeout, invocation.display);
      entries.push({
        id: check.id,
        label: check.label,
        command: executed.command,
        success: executed.success,
        output: executed.output
      });
    }

    const success = entries.every((entry) => entry.success);
    return {
      success,
      summary: success
        ? "Claude runtime looks healthy."
        : "One or more runtime checks failed. Use output below to fix executable/auth issues.",
      entries
    };
  }

  async launchRuntimeTerminal(commandId: string): Promise<RuntimeTerminalLaunchResult> {
    if (process.platform !== "darwin") {
      return {
        ok: false,
        message: "Terminal launch shortcut is currently implemented for macOS only."
      };
    }

    const config = this.getConfig();
    const terminalBase = this.resolveSetupCommand(config);
    if (!terminalBase) {
      return {
        ok: false,
        message: "Claude launch command is empty. Set it in plugin settings."
      };
    }

    let commandLine = formatLaunchCommand(terminalBase, ["--version"]);
    if (commandId === "status") {
      commandLine = formatLaunchCommand(terminalBase, [
        "-p",
        "/status",
        "--output-format",
        "text",
        "--verbose",
        "--permission-mode",
        "plan",
        "--max-turns",
        "1"
      ]);
    } else if (commandId === "login") {
      commandLine = formatLaunchCommand(terminalBase, []);
    }

    const terminalLine = `cd ${shellQuote(config.cwd)}; ${commandLine}`;
    const appleScript = `tell application "Terminal" to do script "${terminalLine
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')}"`;

    const opened = await this.runCommand(
      {
        mode: "direct",
        command: "osascript",
        args: ["-e", 'tell application "Terminal" to activate', "-e", appleScript]
      },
      10000,
      "osascript (open terminal)"
    );
    if (!opened.success) {
      return {
        ok: false,
        message: opened.output || "Failed to open Terminal."
      };
    }

    return {
      ok: true,
      message: `Opened Terminal with: ${commandLine}`
    };
  }

  async stream(request: ModelRequest, hooks?: ModelStreamHooks): Promise<ModelResult> {
    const config = this.getConfig();

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
    const invocation = this.buildRuntimeInvocation(config, args);
    if (invocation.resolveError) {
      throw new Error(invocation.resolveError);
    }

    const streamedAssistantChunks: string[] = [];
    const rawStdoutChunks: string[] = [];
    const rawStderrChunks: string[] = [];
    let finalResultText = "";
    let resultErrorText = "";
    let sessionId: string | undefined;

    await new Promise<void>((resolvePromise, rejectPromise) => {
      const child = spawn(invocation.invocation.command, invocation.invocation.args, {
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
          rejectPromise(
            new Error(
              [
                `Claude launch command failed: ${this.resolveSetupCommand(config)}`,
                `Invocation: ${invocation.display}`,
                "Set Settings -> Claude Panel -> Claude launch command or executable."
              ].join("\n")
            )
          );
          return;
        }
        rejectPromise(error);
      });

      child.on("close", (code) => {
        if (code !== 0) {
          rejectPromise(new Error(rawStderrChunks.join("").trim() || `Claude CLI exited with code ${code}`));
          return;
        }

        if (lineBuffer.trim()) {
          rawStdoutChunks.push(lineBuffer);
        }

        resolvePromise();
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

  private resolveSetupCommand(config: ClaudeCodeConfig): string {
    const fromLaunch = config.launchCommand.trim();
    if (fromLaunch) {
      return fromLaunch;
    }

    const resolved = resolveExecutable(config.executable, config.cwd);
    return (resolved.command ?? config.executable.trim()) || "claude";
  }

  private buildRuntimeInvocation(
    config: ClaudeCodeConfig,
    runtimeArgs: string[]
  ): { invocation: RuntimeInvocation; display: string; resolveError?: string } {
    const launchCommand = config.launchCommand.trim();
    if (launchCommand) {
      const shell = (process.env.SHELL || "/bin/zsh").trim() || "/bin/zsh";
      const shellScript = `cd ${shellQuote(config.cwd)}; ${formatLaunchCommand(launchCommand, runtimeArgs)}`;
      return {
        invocation: {
          mode: "shell",
          command: shell,
          args: ["-ilc", shellScript],
          shellScript
        },
        display: formatLaunchCommand(launchCommand, runtimeArgs)
      };
    }

    const resolved = resolveExecutable(config.executable, config.cwd);
    if (!resolved.command) {
      return {
        invocation: {
          mode: "direct",
          command: config.executable,
          args: runtimeArgs
        },
        display: formatLaunchCommand(config.executable || "claude", runtimeArgs),
        resolveError: [
          `Claude executable not found: ${config.executable}`,
          resolved.tried.length ? `Tried:\n- ${resolved.tried.join("\n- ")}` : "No executable candidates were generated.",
          "Set Settings -> Claude Panel -> Claude launch command (for example: claude or ccs work) or an absolute executable path."
        ].join("\n\n")
      };
    }

    return {
      invocation: {
        mode: "direct",
        command: resolved.command,
        args: runtimeArgs
      },
      display: formatCommand(resolved.command, runtimeArgs)
    };
  }

  private async runCommand(
    invocation: RuntimeInvocation,
    timeoutMs: number,
    displayCommand: string
  ): Promise<CommandExecutionResult> {
    return new Promise<CommandExecutionResult>((resolvePromise) => {
      const child = spawn(invocation.command, invocation.args, {
        cwd: this.getConfig().cwd,
        env: process.env
      });

      const stdout: string[] = [];
      const stderr: string[] = [];
      let completed = false;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, timeoutMs);

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");

      child.stdout.on("data", (chunk: string) => {
        stdout.push(chunk);
      });
      child.stderr.on("data", (chunk: string) => {
        stderr.push(chunk);
      });

      child.on("error", (error) => {
        if (completed) {
          return;
        }
        completed = true;
        clearTimeout(timer);
        resolvePromise({
          command: displayCommand,
          success: false,
          output: error instanceof Error ? error.message : String(error)
        });
      });

      child.on("close", (code) => {
        if (completed) {
          return;
        }
        completed = true;
        clearTimeout(timer);
        const out = stdout.join("").trim();
        const err = stderr.join("").trim();
        const success = code === 0 && !timedOut;
        const output = timedOut
          ? `Timed out after ${timeoutMs}ms`
          : out || err || (success ? "OK" : `Exited with code ${String(code)}`);
        resolvePromise({
          command: displayCommand,
          success,
          output
        });
      });
    });
  }
}
