import path from "node:path";
import { fileURLToPath } from "node:url";
import { tool } from "@opencode-ai/plugin";
import { loadManifest } from "./src/core/manifest.mjs";
import { dispatchPlugin } from "./src/core/dispatch.mjs";
import { FAILURE } from "./src/core/protocol.mjs";
import { createRepoGuardModeTool } from "./src/opencode-tool.mjs";
import { isDisabled } from "./src/mode.mjs";
import { logger } from "./src/logger.mjs";
const root = path.dirname(fileURLToPath(import.meta.url));

export default async function RepoGuardPlugin(context, options = {}) {
  const manifest = loadManifest(root);
  if (typeof context?.directory !== "string" || !path.isAbsolute(context.directory)) throw new Error(FAILURE);
  logger.log("opencode", "plugin_ready");
  return {
    tool: { repo_guard_mode: createRepoGuardModeTool(tool) },
    "tool.execute.before": async (input, output) => {
      try {
        if (isDisabled(input?.sessionID)) return;
        const result = await dispatchPlugin({ root, manifest, host: "opencode", eventName: "tool.before", context: { ...context, pluginOptions: options },
          raw: { ...input, cwd: context.directory, tool_input: output?.args } });
        if (result.action === "deny") throw new Error(result.reason);
      } catch { throw new Error(FAILURE); }
    },
  };
}
