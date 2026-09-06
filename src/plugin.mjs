import path from "node:path";
import { guardRead, guardBash } from "./guard.mjs";
import { FAILURE } from "./core/protocol.mjs";
import { tryResolvePath } from "./command-parser.mjs";
import { loadConfig, normalizeConfig } from "./config.mjs";
const deny = () => ({ action: "deny", reason: FAILURE });
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);

export default async function handle(event, context = {}) {
  const { preflightOnly = false } = context;
  if (event?.protocolVersion !== 1 || event.event !== "tool.before" || !event.tool?.name || !path.isAbsolute(event.cwd || "")) return deny();
  const name = event.tool.name.toLowerCase();
  if (!["read", "bash"].includes(name) && !(event.host === "opencode" && name === "batch")) return { action: "allow" };
  let config;
  try { config = context.config === undefined ? loadConfig(context.pluginOptions) : normalizeConfig(context.config); }
  catch { return deny(); }
  if (event.host === "opencode" && name === "batch") {
    const calls = event.tool.input?.tool_calls;
    if (!Array.isArray(calls) || calls.length > 100) return deny();
    for (const call of calls) {
      if (!object(call) || typeof call.tool !== "string" || !call.tool || call.tool.toLowerCase() === "batch") return deny();
      const result = await handle({ ...event, tool: { name: call.tool, input: call.parameters } }, { config, preflightOnly: true });
      if (result.action === "deny") return result;
    }
    if (!preflightOnly) for (const call of calls) {
      const result = await handle({ ...event, tool: { name: call.tool, input: call.parameters } }, { config });
      if (result.action === "deny") return result;
    }
    return { action: "allow" };
  }
  if (name !== "read" && name !== "bash") return { action: "allow" };
  const input = event.tool.input;
  if (!object(input)) return deny();
  try {
    let result;
    if (name === "read") {
      const file = event.host === "opencode" ? input.filePath : input.file_path;
      if (typeof file !== "string" || !file.trim()) return deny();
      result = guardRead({ cwd: event.cwd, session_id: event.sessionId, tool_input: { file_path: file } }, event.host, preflightOnly, config);
    } else {
      if (typeof input.command !== "string" || !input.command.trim()) return deny();
      // Retired shell shortcut must not silently change guard state.
      if (/^repo-guard-mode\s+/i.test(input.command.trim())) return deny();
      const workdir = input.workdir ?? input.cwd;
      if (workdir !== undefined && (typeof workdir !== "string" || !workdir.trim())) return deny();
      const cwd = workdir ? tryResolvePath(workdir, event.cwd) : event.cwd;
      if (!cwd) return deny();
      result = guardBash({ cwd, session_id: event.sessionId, tool_input: { command: input.command } }, event.host, preflightOnly, config);
    }
    return result.decision === "block" ? { action: "deny", reason: result.reason } : { action: "allow" };
  } catch { return deny(); }
}
