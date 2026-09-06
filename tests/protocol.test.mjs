import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import handler from "../src/plugin.mjs";
import { normalizeHostInput, normalizePluginResult } from "../src/core/protocol.mjs";
import { buildHosts } from "../src/build.mjs";
import { normalizeGitUrl } from "../src/git-url.mjs";
import { getNormalizedRemoteUrl } from "../src/git-info.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
test("SSH normalization has no organization-specific host exception", () => {
  assert.equal(normalizeGitUrl("git@git.example.invalid:team/repo.git"), "https://git.example.invalid/team/repo");
  assert.equal(normalizeGitUrl("ssh://git@other.example.invalid/team/repo.git"), "https://other.example.invalid/team/repo");
});

test("canonical three-host equivalence, workdir and batch", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guard-protocol-"));
  const csv = path.join(tmp, "policy.csv");
  const config = { whitelistCsv: csv };
  const handle = event => handler(event, { config });
  try {
    fs.writeFileSync(csv, "name,repo,details\nAllowed,https://example.invalid/example/allowed,Example\n");
    for (const name of ["allowed", "blocked"]) {
      const dir = path.join(tmp, name); fs.mkdirSync(dir);
      assert.equal(spawnSync("git", ["init", dir]).status, 0);
      assert.equal(spawnSync("git", ["-C", dir, "remote", "add", "origin", `https://example.invalid/example/${name}`]).status, 0);
    }
    for (const host of ["codex", "claude", "opencode"]) {
      for (const name of ["allowed", "blocked"]) {
        const cwd = path.join(tmp, name);
        for (const tool of ["Read", "Bash"]) {
          const input = tool === "Bash" ? { command: "pwd" } : host === "opencode" ? { filePath: path.join(cwd, "x") } : { file_path: path.join(cwd, "x") };
          const event = normalizeHostInput(host, "tool.before", { cwd, tool_name: tool, tool_input: input });
          assert.equal((await handle(event)).action, name === "allowed" ? "allow" : "deny");
          event.tool.input = {};
          assert.equal((await handle(event)).action, "deny");
        }
      }
      const event = normalizeHostInput(host, "tool.before", { cwd: path.join(tmp, "allowed"), tool_name: "Bash", tool_input: { command: "pwd", workdir: "../blocked" } });
      assert.equal((await handle(event)).action, "deny");
      event.tool = { name: "other", input: {} };
      assert.equal((await handle(event)).action, "allow");
    }
    const batch = normalizeHostInput("opencode", "tool.before", { cwd: path.join(tmp, "allowed"), tool: "batch", tool_input: { tool_calls: [
      ...Array.from({ length: 10 }, () => ({ tool: "write", parameters: {} })),
      { tool: "read", parameters: { filePath: path.join(tmp, "blocked/x") } },
    ] } });
    assert.equal((await handle(batch)).action, "deny");
    assert.throws(() => normalizeHostInput("opencode", "tool.before", { tool: "read" }));
    assert.throws(() => normalizePluginResult(null));
    // Policy reload after deletion, restoration and relative path override.
    const allowedEvent = normalizeHostInput("codex", "tool.before", { cwd: path.join(tmp, "allowed"), tool_name: "Bash", tool_input: { command: "pwd" } });
    fs.unlinkSync(csv); assert.equal((await handle(allowedEvent)).action, "deny");
    fs.writeFileSync(csv, "name,repo,details\nAllowed,https://example.invalid/example/allowed,Example\n");
    assert.equal((await handle(allowedEvent)).action, "allow");
    for (const configArgs of [["remote.origin.url", ""], ["--unset", "remote.origin.url"]]) {
      assert.equal(spawnSync("git", ["-C", path.join(tmp, "allowed"), "config", ...configArgs]).status, 0);
      assert.equal(getNormalizedRemoteUrl(path.join(tmp, "allowed")).remoteState, "invalid");
      for (const host of ["codex", "claude", "opencode"]) {
        for (const tool of ["Read", "Bash"]) {
          const input = tool === "Bash" ? { command: "pwd" } : host === "opencode" ? { filePath: path.join(tmp, "allowed/x") } : { file_path: path.join(tmp, "allowed/x") };
          const event = normalizeHostInput(host, "tool.before", { cwd: path.join(tmp, "allowed"), tool_name: tool, tool_input: input });
          assert.equal((await handle(event)).action, "deny", "configured remote without URL is not absent");
        }
      }
    }
    assert.equal(spawnSync("git", ["-C", path.join(tmp, "allowed"), "remote", "remove", "origin"]).status, 0);
    assert.equal((await handle(allowedEvent)).action, "allow", "genuinely absent remote retains existing behavior");
    assert.equal(getNormalizedRemoteUrl(path.join(tmp, "allowed")).remoteState, "absent");
    assert.equal(spawnSync("git", ["-C", path.join(tmp, "allowed"), "remote", "add", "origin", "https://example.invalid/example/allowed"]).status, 0);
    for (const remote of [
      "https://other.example.invalid/example/allowed", "https://sub.example.invalid/example/allowed",
      "https://example.invalid/Example/allowed", "http://example.invalid/example/allowed",
      "ssh://git@example.invalid:443/example/allowed", "https://example.invalid/example/../allowed",
    ]) {
      assert.equal(spawnSync("git", ["-C", path.join(tmp, "allowed"), "remote", "set-url", "origin", remote]).status, 0);
      for (const host of ["codex", "claude", "opencode"]) {
        assert.equal((await handle({ ...allowedEvent, host })).action, "deny", remote);
        const read = { ...allowedEvent, host, tool: { name: "Read", input: host === "opencode" ? { filePath: path.join(tmp, "allowed/x") } : { file_path: path.join(tmp, "allowed/x") } } };
        assert.equal((await handle(read)).action, "deny", remote);
      }
    }
    assert.equal(spawnSync("git", ["-C", path.join(tmp, "allowed"), "remote", "set-url", "origin", "git@example.invalid:example/allowed.git"]).status, 0);
    assert.equal((await handle(allowedEvent)).action, "allow");
    config.whitelistCsv = "relative.csv";
    assert.equal((await handle(allowedEvent)).action, "deny");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("built bridges fail closed even when runtime files or root are missing", () => {
  const { results } = buildHosts({ root });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guard-bridge-"));
  try {
    for (const host of ["codex", "claude"]) {
      const plugin = path.join(tmp, host); fs.cpSync(results[host], plugin, { recursive: true });
      const command = JSON.parse(fs.readFileSync(path.join(plugin, "hooks/hooks.json"))).hooks.PreToolUse[0].hooks[0].command;
      const key = host === "claude" ? "CLAUDE_PLUGIN_ROOT" : "PLUGIN_ROOT";
      const env = { PATH: process.env.PATH, HOME: tmp, [key]: plugin };
      const run = input => spawnSync("sh", ["-c", command], { env, cwd: tmp, input, encoding: "utf8" });
      for (const input of ["", "null", "[]", "{bad", JSON.stringify({ hook_event_name: "SessionStart" })]) assert.equal(run(input).status, 2);
      const denied = run(JSON.stringify({ hook_event_name: "PreToolUse", cwd: tmp, tool_name: "Read", tool_input: {} }));
      assert.equal(denied.status, 0);
      assert.equal(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision, "deny");
      fs.unlinkSync(path.join(plugin, "src/core/dispatch.mjs"));
      const missingImport = run("{}"); assert.equal(missingImport.status, 2); assert(!missingImport.stderr.includes(plugin));
      fs.unlinkSync(path.join(plugin, "scripts/host-hook.mjs")); assert.equal(run("{}").status, 2);
      delete env[key]; assert.equal(run("{}").status, 2);
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
