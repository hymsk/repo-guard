#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HOSTS, runNative } from "../src/native-install.mjs";

const USAGE = "Usage: agent-plugin <build|validate|install|uninstall> [--host all|codex|claude|opencode] [--apply]";
export function main(argv, options = {}) {
  if (!argv.length || (argv.length === 1 && ["help", "--help", "-h"].includes(argv[0]))) return { ok: true, usage: USAGE };
  const [action, ...args] = argv;
  if (!["build", "validate", "install", "uninstall"].includes(action)) throw new Error(USAGE);
  let host, apply = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--host" && host === undefined && typeof args[index + 1] === "string") host = args[++index];
    else if (args[index] === "--apply" && !apply && ["install", "uninstall"].includes(action)) apply = true;
    else throw new Error(USAGE);
  }
  if (host !== undefined && host !== "all" && !HOSTS.includes(host)) throw new Error(USAGE);
  return runNative(action, !host || host === "all" ? HOSTS : [host], { ...options, apply });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let payload;
  try { payload = main(process.argv.slice(2)); }
  catch { payload = { ok: false, error: USAGE, results: [] }; }
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  if (!payload.ok) process.exitCode = 1;
}
