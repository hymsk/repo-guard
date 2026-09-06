
/**
 * src/guard.mjs — 核心拦截逻辑。
 *
 * 对 Read / Bash 先检查目录禁止标记，再检查本地黑白名单策略。
 *
 * 内部阻断结果（由宿主适配层转换为具体协议）：
 *   { "decision": "block", "reason": "..." }
 * 放行输出：
 *   {}
 */

import path from "node:path";
import { isAllowed, getStats } from "./whitelist.mjs";
import { getNormalizedRemoteUrl } from "./git-info.mjs";
import { checkForbiddenPaths } from "./forbidden-path.mjs";
import { extractFilePathsFromCommand, tryResolvePath } from "./command-parser.mjs";
import { logger } from "./logger.mjs";
import { loadConfig } from "./config.mjs";

const REPO_NOT_ALLOWED_REASON = "安全拦截: 目标仓库未通过本地黑白名单策略。";
const FORBIDDEN_PATH_REASON = "安全拦截: 目标目录受禁止标记保护，或无法完成目录校验。";
const INVALID_INPUT_REASON = "安全拦截: repo-guard 无法校验本次工具调用参数。";

function block(reason) {
  logger.log("guard", `BLOCK reason=${reason}`);
  return { decision: "block", reason };
}

function pass() {
  return {};
}

function checkFileRepo(absFilePath, hookInput, platform, config) {
  const cwd = hookInput.cwd || process.cwd();
  const gitCwd = absFilePath ? path.dirname(absFilePath) : cwd;

  const { repoRoot, remoteUrl, normalizedUrl, remoteState } = getNormalizedRemoteUrl(gitCwd, config.remote);

  if (!repoRoot) {
    return { allowed: true, repoUrl: null, reason: "non-git" };
  }

  if (remoteState === "absent") {
    return { allowed: true, repoUrl: null, reason: "no-remote" };
  }

  if (isAllowed(remoteUrl, config)) {
    return { allowed: true, repoUrl: normalizedUrl };
  }

  return { allowed: false, reason: "repo-not-allowed", repoUrl: normalizedUrl };
}

function checkCwdRepo(cwd, config) {
  const { repoRoot, remoteUrl, normalizedUrl, remoteState } = getNormalizedRemoteUrl(cwd, config.remote);

  if (!repoRoot) {
    return { allowed: true, repoUrl: null, reason: "non-git" };
  }

  if (remoteState === "absent") {
    return { allowed: true, repoUrl: null, reason: "no-remote" };
  }

  if (isAllowed(remoteUrl, config)) {
    return { allowed: true, repoUrl: normalizedUrl };
  }

  return { allowed: false, reason: "repo-not-allowed", repoUrl: normalizedUrl };
}

export function guardRead(hookInput, platform, preflightOnly = false, config = loadConfig()) {
  const filePath = hookInput.tool_input?.file_path || null;
  const cwd = hookInput.cwd || process.cwd();
  const sessionId = hookInput.session_id || "null";

  if (!filePath) {
    logger.log("guard", `read_no_file_path session=${sessionId}`);
    return block(INVALID_INPUT_REASON);
  }

  const absPath = tryResolvePath(filePath, cwd);
  if (!absPath) {
    logger.log("guard", `read_path_resolve_failed raw=${filePath} cwd=${cwd}`);
    return block(INVALID_INPUT_REASON);
  }

  if (!checkForbiddenPaths([absPath], config).allowed) return block(FORBIDDEN_PATH_REASON);
  if (preflightOnly) return pass();
  const result = checkFileRepo(absPath, hookInput, platform, config);
  if (result.allowed) {
    logger.log("guard", `read_pass file=${absPath} repo=${result.repoUrl || "null"} session=${sessionId}`);
    return pass();
  }

  logger.log("guard", `read_block file=${absPath} repo=${result.repoUrl || "null"} session=${sessionId}`);
  return block(REPO_NOT_ALLOWED_REASON);
}

export function guardBash(hookInput, platform, preflightOnly = false, config = loadConfig()) {
  const command = hookInput.tool_input?.command || null;
  const cwd = hookInput.cwd || process.cwd();
  const sessionId = hookInput.session_id || "null";

  if (!command || typeof command !== "string" || command.trim() === "") {
    logger.log("guard", `bash_no_command session=${sessionId}`);
    return block(INVALID_INPUT_REASON);
  }

  const parsed = extractFilePathsFromCommand(command, cwd);
  if (!parsed.safe) {
    logger.log("guard", `bash_unparseable session=${sessionId}`);
    return block(INVALID_INPUT_REASON);
  }
  const { paths, effectiveCwd } = parsed;

  // Preflight ALL paths before the first Git subprocess, including cd operands.
  const targets = [cwd, effectiveCwd, ...paths.map(({ raw, resolveCwd }) => tryResolvePath(raw, resolveCwd))];
  if (!checkForbiddenPaths(targets, config).allowed) return block(FORBIDDEN_PATH_REASON);
  if (preflightOnly) return pass();

  const cwdResult = checkCwdRepo(cwd, config);
  if (!cwdResult.allowed) {
    logger.log("guard", `bash_cwd_not_allowed cwd=${cwd} repo=${cwdResult.repoUrl || "null"} session=${sessionId}`);
    return block(REPO_NOT_ALLOWED_REASON);
  }

  const resolvedCwd = tryResolvePath(cwd, process.cwd());
  const resolvedEffectiveCwd = tryResolvePath(effectiveCwd, cwd);
  if (resolvedEffectiveCwd && resolvedEffectiveCwd !== resolvedCwd) {
    const effectiveResult = checkCwdRepo(resolvedEffectiveCwd, config);
    if (!effectiveResult.allowed) {
      logger.log("guard", `bash_effective_cwd_not_allowed cwd=${resolvedEffectiveCwd} repo=${effectiveResult.repoUrl || "null"} session=${sessionId}`);
      return block(REPO_NOT_ALLOWED_REASON);
    }
  }

  if (paths.length === 0) {
    logger.log("guard", `bash_cwd_pass cwd=${effectiveCwd} repo=${cwdResult.repoUrl || "null"} session=${sessionId}`);
    return pass();
  }

  for (const { raw, resolveCwd } of paths) {
    const absPath = tryResolvePath(raw, resolveCwd);
    if (!absPath) continue;

    const result = checkFileRepo(absPath, hookInput, platform, config);
    if (!result.allowed) {
      logger.log("guard", `bash_block file=${absPath} repo=${result.repoUrl || "null"} command=${command.slice(0, 60)} session=${sessionId}`);
      return block(REPO_NOT_ALLOWED_REASON);
    }
  }

  logger.log("guard", `bash_pass command=${command.slice(0, 60)} session=${sessionId}`);
  return pass();
}

export function guardSessionStart(hookInput, platform, config = loadConfig()) {
  const cwd = hookInput.cwd || process.cwd();
  const sessionId = hookInput.session_id || "null";

  if (!checkForbiddenPaths([cwd], config).allowed) return block(FORBIDDEN_PATH_REASON);
  const { repoRoot, remoteUrl, remoteState } = getNormalizedRemoteUrl(cwd, config.remote);

  if (!repoRoot || remoteState === "absent") {
    logger.log("guard", `session_start_no_repo cwd=${cwd} session=${sessionId}`);
    return pass();
  }

  if (!isAllowed(remoteUrl, config)) {
    logger.log("guard", `session_start_block session=${sessionId}`);
    return block(REPO_NOT_ALLOWED_REASON);
  }

  const stats = getStats(config);
  logger.log("guard", `session_start_pass whitelist_size=${stats.normalizedSetSize} session=${sessionId}`);
  return pass();
}
