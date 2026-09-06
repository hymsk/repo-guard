
/**
 * src/command-parser.mjs — 从 Bash 命令中提取文件路径。
 *
 * 简化版，仅提取路径 token 并尝试解析为绝对路径。
 * 启发式检查，不等同于完整 shell 语义解析。
 */

import path from "node:path";

const SHELL_OPERATORS = new Set([
  "|", ">", "<", ">>", "<<", "&&", "||", ";", "&",
  "2>", "1>", "2>&1", ">&2", "1>&2", "2>>",
]);

export function tokenizeCommand(command) {
  if (typeof command !== "string" || command.trim() === "") return [];

  const tokens = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (inSingle) {
      if (ch === "'") { inSingle = false; } else { current += ch; }
      continue;
    }
    if (inDouble) {
      if (ch === '"') { inDouble = false; }
      else if (ch === "\\" && i + 1 < command.length) {
        const next = command[i + 1];
        if (next === '"' || next === "\\") { i++; current += next; }
        else { current += ch; }
      } else { current += ch; }
      continue;
    }
    if (ch === "'") { inSingle = true; continue; }
    if (ch === '"') { inDouble = true; continue; }
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      if (current !== "") { tokens.push(current); current = ""; }
      continue;
    }
    current += ch;
  }
  if (current !== "") tokens.push(current);
  return tokens;
}

// This is deliberately a conservative preflight, not a shell parser. Anything
// whose shell meaning cannot be determined without executing a shell is denied
// by the caller instead of being treated as an ordinary path token.
export function isSafelyParseableCommand(command) {
  if (typeof command !== "string" || command.trim() === "") return false;
  let inSingle = false;
  let inDouble = false;
  for (const ch of command) {
    if (ch === "'") { if (!inDouble) inSingle = !inSingle; continue; }
    if (ch === '"') { if (!inSingle) inDouble = !inDouble; continue; }
    if (inSingle) continue;
    if (ch === "\\" || ch === "$" || ch === "`" || "|;&<>*?[](){}".includes(ch)) return false;
  }
  if (inSingle || inDouble) return false;
  const tokens = tokenizeCommand(command);
  if (tokens.some(token => token.startsWith("-") && token.includes("="))) return false;
  const executable = path.basename(tokens[0] || "").toLowerCase();
  if (["sh", "bash", "dash", "zsh", "ksh", "fish"].includes(executable)
    && tokens.some(token => token === "-c" || token === "--command")) return false;
  return true;
}

function looksLikeFilePath(token) {
  if (typeof token !== "string" || token.length === 0) return false;
  if (token.includes("/") || token.includes("\\")) return true;
  if (token.includes(".")) return true;
  return false;
}

export function extractFilePathsFromCommand(command, baseCwd) {
  if (!isSafelyParseableCommand(command)) return { paths: [], effectiveCwd: baseCwd, safe: false };
  const tokens = tokenizeCommand(command);
  if (tokens.length === 0) return { paths: [], effectiveCwd: baseCwd, safe: false };

  const paths = [];
  const seen = new Set();
  let currentCwd = baseCwd;
  let pendingCd = false;
  let skipNextPath = false;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (pendingCd) {
      if (token.startsWith("-")) continue;
      if (SHELL_OPERATORS.has(token)) { pendingCd = false; skipNextPath = false; continue; }
      const resolved = tryResolvePath(token, currentCwd);
      if (!resolved) paths.push({ raw: token, resolveCwd: currentCwd });
      if (resolved) {
        paths.push({ raw: resolved, resolveCwd: currentCwd });
        currentCwd = resolved;
      }
      pendingCd = false;
      if (skipNextPath) { skipNextPath = false; continue; }
    }

    if (SHELL_OPERATORS.has(token)) { skipNextPath = false; continue; }
    if (token.startsWith("-")) {
      // Option values can carry paths that this lightweight parser cannot
      // safely associate with a specific command, e.g. --file=/secret.
      if (token.includes("=")) return { paths: [], effectiveCwd: baseCwd, safe: false };
      continue;
    }
    if (token === "cd") { pendingCd = true; skipNextPath = true; continue; }
    if (skipNextPath) { skipNextPath = false; continue; }
    // Bare operands (e.g. `cat secret`) can refer to protected files too.
    if (i === 0 && !looksLikeFilePath(token)) continue;

    const cleaned = token.replace(/^['"]+|['"]+$/g, "");
    if (cleaned === "") continue;
    const identity = `${currentCwd}\0${cleaned}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    paths.push({ raw: cleaned, resolveCwd: currentCwd });
  }

  return { paths, effectiveCwd: currentCwd, safe: true };
}

export function tryResolvePath(rawPath, cwd) {
  if (!rawPath || typeof rawPath !== "string") return null;
  // Lexical normalization before realpath can redirect symlink/../ targets.
  if (rawPath.split(/[\\/]/).includes("..") || (cwd && cwd.split(/[\\/]/).includes(".."))) return null;
  try {
    if (path.isAbsolute(rawPath)) return path.normalize(rawPath);
    return path.resolve(cwd || process.cwd(), rawPath);
  } catch { return null; }
}
