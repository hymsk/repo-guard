import path from "node:path";
export const FAILURE = "安全拦截: repo-guard 无法校验本次工具调用。";
export function normalizeHostInput(host, eventName, raw) {
  if (!["codex", "claude", "opencode"].includes(host) || eventName !== "tool.before"
    || !raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(FAILURE);
  const name = raw.tool_name ?? raw.tool;
  if (typeof name !== "string" || !name.trim() || typeof raw.cwd !== "string" || !path.isAbsolute(raw.cwd)) throw new Error(FAILURE);
  return { protocolVersion: 1, host, event: eventName, sessionId: raw.session_id ?? raw.sessionID ?? null,
    cwd: raw.cwd, tool: { name, input: raw.tool_input }, raw };
}
export function normalizePluginResult(result) {
  if (!result || !["allow", "deny"].includes(result.action) || (result.action === "deny" && (typeof result.reason !== "string" || !result.reason.trim()))) throw new Error(FAILURE);
  return result.action === "allow" ? { action: "allow" } : { action: "deny", reason: result.reason };
}
export function encodeHostResult(host, eventName, result) {
  if (!["codex", "claude"].includes(host) || eventName !== "tool.before") throw new Error(FAILURE);
  if (result.action === "allow") return {};
  return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: result.reason } };
}
