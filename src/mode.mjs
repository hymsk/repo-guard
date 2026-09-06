
/**
 * src/mode.mjs — OpenCode repo-guard 开关状态（按会话隔离）。
 *
 * 用一个标记文件表示「关闭」状态：文件存在即关闭拦截，不存在即启用。
 *
 * 状态按 OpenCode 会话隔离：每个 sessionID 对应独立标记文件，
 * 关闭只影响当前会话，其它会话窗口不受影响。
 *
 *   标记文件：~/.repo-guard/opencode-disabled-<sessionID>
 *
 * 每次 OpenCode 会话默认为启用：插件不主动创建/删除标记文件，
 * 用户切换后仅当次会话关闭；下次新会话默认重新启用。
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { logger } from "./logger.mjs";

function sanitizeSessionId(sessionId) {
  if (typeof sessionId !== "string" || sessionId.trim() === "") return "";
  const cleaned = sessionId.replace(/[^A-Za-z0-9._-]/g, "_");
  if (cleaned !== sessionId) {
    const hash = crypto.createHash("sha256").update(sessionId, "utf8").digest("hex").slice(0, 16);
    return `${cleaned}_${hash}`;
  }
  return cleaned;
}

export function getDisabledFilePath(sessionId) {
  const override = process.env.REPO_GUARD_DISABLED_FILE;
  if (override) return path.resolve(override);

  const dir = process.env.REPO_GUARD_DIR
    ? path.resolve(process.env.REPO_GUARD_DIR)
    : path.join(os.homedir(), ".repo-guard");

  const safe = sanitizeSessionId(sessionId);
  if (!safe) return path.join(dir, "opencode-disabled");
  return path.join(dir, `opencode-disabled-${safe}`);
}

export function isDisabled(sessionId) {
  return fs.existsSync(getDisabledFilePath(sessionId));
}

export function getDisabledPath(sessionId) {
  return getDisabledFilePath(sessionId);
}

export function setDisabled(disabled, sessionId) {
  const filePath = getDisabledFilePath(sessionId);
  if (disabled) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "", "utf8");
    logger.log("mode", `disabled session=${sessionId || "global"}`);
    return true;
  }
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    logger.log("mode", `enabled session=${sessionId || "global"}`);
    return true;
  }
  return false;
}
