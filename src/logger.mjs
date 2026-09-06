
/**
 * src/logger.mjs — 轻量文件日志。
 *
 * 仅 REPO_GUARD_LOG_LEVEL=debug 时启用。
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

let _logPath = null;

function getLogPath() {
  if (_logPath !== null) return _logPath;
  _logPath = process.env.REPO_GUARD_LOG_FILE
    || path.join(os.homedir(), ".repo-guard", "guard.log");
  return _logPath;
}

function isEnabled() {
  return process.env.REPO_GUARD_LOG_LEVEL === "debug";
}

function formatLine(tag, message) {
  const now = new Date();
  const offsetMs = 8 * 60 * 60 * 1000;
  const local = new Date(now.getTime() + offsetMs);
  const ts = local.toISOString().replace("Z", "+08:00");
  return `${ts} [DEBUG] [${tag}] ${message}\n`;
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export const logger = {
  initSession(tag, message) {
    if (!isEnabled()) return;
    try {
      const filePath = getLogPath();
      ensureDir(filePath);
      fs.writeFileSync(filePath, formatLine(tag, message), "utf8");
    } catch { /* silent */ }
  },

  log(tag, message) {
    if (!isEnabled()) return;
    try {
      const filePath = getLogPath();
      ensureDir(filePath);
      fs.appendFileSync(filePath, formatLine(tag, message), "utf8");
    } catch { /* silent */ }
  },
};

export function isDebugEnabled() {
  return isEnabled();
}
