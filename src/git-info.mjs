
/**
 * src/git-info.mjs — 轻量 Git 信息采集。
 *
 * 只做拦截需要的最小采集：repo_root + remote URL。
 * 独立实现，不调用审计插件。
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { normalizeGitUrl } from "./git-url.mjs";
import { logger } from "./logger.mjs";

let _gitExe = null;

function resolveGitExe() {
  if (_gitExe) return _gitExe;
  try {
    const r = spawnSync("git", ["--version"], { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] });
    if (r.status === 0 && !r.error) { _gitExe = "git"; return _gitExe; }
  } catch { /* fallback */ }
  if (process.platform === "win32") {
    try {
      const wr = spawnSync("where", ["git"], { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] });
      if (wr.status === 0 && wr.stdout) {
        const first = wr.stdout.split("\n")[0].trim().replace(/\r$/, "");
        if (first) { _gitExe = first; return _gitExe; }
      }
    } catch { /* continue */ }
  }
  _gitExe = "git";
  return _gitExe;
}

function runGit(args, cwd, allowEmpty = false) {
  try {
    const exe = resolveGitExe();
    const result = spawnSync(exe, ["-c", "safe.directory=*", ...args], {
      cwd,
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (result.error || result.status !== 0) return null;
    let output = result.stdout;
    if (output.endsWith("\n")) output = output.slice(0, -1);
    if (output.endsWith("\r")) output = output.slice(0, -1);
    return allowEmpty ? output : output || null;
  } catch {
    return null;
  }
}

export function getRepoRoot(cwd) {
  return runGit(["rev-parse", "--show-toplevel"], cwd);
}

export function getRemoteUrl(repoRoot, remoteName) {
  const name = remoteName || "origin";
  return runGit(["remote", "get-url", name], repoRoot);
}

export function getNormalizedRemoteUrl(cwd, remoteName = "origin") {
  const repoRoot = getRepoRoot(cwd);
  if (!repoRoot) {
    logger.log("git-info", `no_repo_root cwd=${cwd}`);
    return { repoRoot: null, remoteUrl: null, normalizedUrl: null, remoteState: "not-a-repo" };
  }

  const remotes = runGit(["remote"], repoRoot, true);
  if (remotes === null) return { repoRoot, remoteUrl: null, normalizedUrl: null, remoteState: "error" };
  const selected = remoteName;
  if (!remotes.split(/\r?\n/).includes(selected)) {
    return { repoRoot, remoteUrl: null, normalizedUrl: null, remoteState: "absent" };
  }
  const rawUrl = getRemoteUrl(repoRoot, selected);
  if (!rawUrl) {
    logger.log("git-info", "remote_url_unavailable");
    return { repoRoot, remoteUrl: null, normalizedUrl: null, remoteState: "invalid" };
  }

  const normalizedUrl = normalizeGitUrl(rawUrl);
  logger.log("git-info", `resolved cwd=${cwd} repo_root=${repoRoot} raw=${rawUrl} normalized=${normalizedUrl || "null"}`);

  return { repoRoot, remoteUrl: rawUrl, normalizedUrl, remoteState: normalizedUrl ? "valid" : "invalid" };
}
