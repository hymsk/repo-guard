#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runNative, selectHosts } from "../src/native-install.mjs";

const PROTOCOL = "codeagent-installer/v1";
const USAGE = "Usage: codeagent-install.mjs plan|status|sync --hosts codex,claude,opencode [--json]";

export function runInstaller(action, hosts, options = {}) {
  if (!["plan", "status", "sync"].includes(action)) throw new Error(USAGE);
  const inherited = options.env || process.env;
  // runtime.py injects HOME, but retains inherited host config overrides.
  // This boundary belongs only to CodeAgent; the native CLI may target an
  // explicitly chosen configuration outside HOME.
  const home = inherited.AI_MANAGER_HOME || inherited.HOME;
  const validHome = typeof home === "string" && path.isAbsolute(home);
  const env = validHome ? { ...inherited, HOME: path.resolve(home), USERPROFILE: path.resolve(home) } : { ...inherited };
  const withinHome = value => {
    if (!value) return true;
    if (typeof value !== "string" || !path.isAbsolute(value)) return false;
    const relative = path.relative(env.HOME, path.resolve(value));
    return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  };
  const results = selectHosts(hosts).flatMap(host => {
    const keys = ["XDG_CONFIG_HOME", ...{
      codex: ["CODEX_HOME"], claude: ["CLAUDE_CONFIG_DIR"], opencode: ["OPENCODE_CONFIG_DIR", "OPENCODE_CONFIG"],
    }[host]];
    if (!validHome || keys.some(key => !withinHome(env[key]))) return [{ host, status: "failed", changed: false,
      message: "宿主配置环境变量越过 CodeAgent HOME 边界；未调用宿主或修改安装", details: { code: "target", phase: "environment", writesAttempted: false } }];
    return runNative(action, [host], { ...options, env }).results;
  });
  // Protocol success is independent of host-level failure. A nonzero exit would
  // cause the manager to discard otherwise useful per-host partial results.
  return { protocol: PROTOCOL, ok: true, results };
}

export function main(argv, options) {
  const [action, ...args] = argv;
  let hosts, json = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--hosts" && hosts === undefined && typeof args[index + 1] === "string") {
      hosts = args[++index].split(",").map(host => host.trim());
    } else if (args[index] === "--json" && !json) json = true;
    else throw new Error(USAGE);
  }
  return runInstaller(action, hosts, options);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let payload;
  try { payload = main(process.argv.slice(2)); }
  catch {
    payload = { protocol: PROTOCOL, ok: false, error: USAGE, results: [] };
    process.exitCode = 1;
  }
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}
