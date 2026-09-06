#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dispatchPlugin } from "../src/core/dispatch.mjs";
import { loadManifest } from "../src/core/manifest.mjs";
import { encodeHostResult, FAILURE } from "../src/core/protocol.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const option = name => process.argv[process.argv.indexOf(name) + 1];
try {
  const host = option("--host"), eventName = option("--event");
  if (!["codex", "claude"].includes(host) || eventName !== "tool.before") throw new Error(FAILURE);
  const chunks = []; let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error(FAILURE);
    chunks.push(chunk);
  }
  const raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (raw?.hook_event_name !== "PreToolUse") throw new Error(FAILURE);
  const result = await dispatchPlugin({ root, manifest: loadManifest(root), host, eventName, raw });
  process.stdout.write(`${JSON.stringify(encodeHostResult(host, eventName, result))}\n`);
} catch {
  process.stderr.write(`${FAILURE}\n`);
  process.exitCode = 2;
}
