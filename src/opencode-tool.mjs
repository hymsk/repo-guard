import { isDisabled, setDisabled } from "./mode.mjs";

/** SDK supplied by the host loader; keep payload independent of node_modules. */
export function createRepoGuardModeTool(tool) {
  return tool({
    description: "查询或切换当前会话的 repo-guard 黑白名单及目录标记检查；关闭必须经用户许可。",
    args: { action: tool.schema.enum(["on", "off", "status"]).describe("on 启用 / off 临时关闭 / status 查询") },
    async execute(args, ctx) {
      if (!ctx?.sessionID) throw new Error("A sessionID is required");
      if (!["on", "off", "status"].includes(args?.action)) throw new Error("Invalid action");
      if (args.action === "off") {
        if (typeof ctx.ask !== "function") throw new Error("Host permission API unavailable; refusing to disable");
        await ctx.ask({ permission: "repo_guard_disable", patterns: ["current-session"], always: ["current-session"], metadata: { action: "off" } });
        setDisabled(true, ctx.sessionID);
      } else if (args.action === "on") setDisabled(false, ctx.sessionID);
      return isDisabled(ctx.sessionID) ? "repo-guard 状态: 关闭（仅当前会话）" : "repo-guard 状态: 启用";
    },
  });
}
