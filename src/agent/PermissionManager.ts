import { AgentMode } from "../state/types";

export class PermissionManager {
  canWrite(mode: AgentMode): boolean {
    return mode !== "plan";
  }

  needsApproval(mode: AgentMode): boolean {
    return mode === "normal";
  }

  shouldAutoApply(mode: AgentMode): boolean {
    return mode === "auto-apply";
  }
}
