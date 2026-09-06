import fs from "node:fs";
import path from "node:path";
export const HOSTS = Object.freeze(["codex", "claude", "opencode"]);
export function loadManifest(root) {
  const m = JSON.parse(fs.readFileSync(path.join(root, "agent-plugin.json"), "utf8"));
  if (!m || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(m.name) || !/^\d+\.\d+\.\d+$/.test(m.version)
    || typeof m.description !== "string" || !m.author?.name || m.entry !== "./src/plugin.mjs") throw new Error("Invalid plugin manifest");
  if (JSON.stringify(m.capabilities?.hooks) !== '["tool.before"]') throw new Error("Only tool.before is supported");
  for (const key of ["skills", "commands", "agents"]) {
    if (!Array.isArray(m.capabilities[key]) || m.capabilities[key].length) throw new Error("Unsupported capability");
  }
  if (!m.capabilities.mcpServers || Object.keys(m.capabilities.mcpServers).length) throw new Error("MCP is not supported");
  for (const host of HOSTS) if (m.hosts?.[host]?.enabled !== true) throw new Error("All three hosts must be enabled");
  const target = path.resolve(root, m.entry);
  if (!fs.realpathSync(target).startsWith(`${fs.realpathSync(root)}${path.sep}`)) throw new Error("Entry escapes root");
  return m;
}
