import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadConfig, normalizeConfig } from "../src/config.mjs";
import handle from "../src/plugin.mjs";
import { normalizeHostInput } from "../src/core/protocol.mjs";
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("plugin configuration file reload, option precedence, isolation and strict validation", async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "guard-config-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  t.mock.method(os, "homedir", () => home);
  const file = path.join(home, ".repo-guard/config.json");
  assert.equal(loadConfig().policyMode, "whitelist");
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify({ policyMode: "blacklist", blacklistCsv: path.join(home, "deny.csv"), forbiddenMarker: ".private" }));
  const a = loadConfig({ forbiddenMarker: ".no-ai" });
  const b = loadConfig({ policyMode: "whitelist" });
  assert.equal(a.forbiddenMarker, ".no-ai"); assert.equal(b.forbiddenMarker, ".private");
  assert.equal(a.policyMode, "blacklist"); assert.equal(b.policyMode, "whitelist");
  assert(Object.isFrozen(a));
  fs.writeFileSync(file, '{"remote":"upstream"}');
  assert.equal(loadConfig().remote, "upstream"); assert.equal(loadConfig().policyMode, "whitelist");
  for (const invalid of [null, [], { unknown: true }, { policyMode: "typo" }, { blacklistCsv: "relative.csv" }, { forbiddenMarker: "../bad" }, { remote: "--flag" }]) {
    assert.throws(() => normalizeConfig(invalid));
  }
  fs.writeFileSync(file, "broken");
  assert.throws(() => loadConfig());
  const event = normalizeHostInput("codex", "tool.before", { cwd: home, tool_name: "Bash", tool_input: { command: "pwd" } });
  assert.equal((await handle(event)).action, "deny", "invalid config denies even non-Git protected calls");
  assert.equal((await handle({ ...event, tool: { name: "other" } })).action, "allow");
  fs.unlinkSync(file); assert.equal(loadConfig().policyMode, "whitelist");
  fs.symlinkSync(path.join(home, "missing"), file); assert.throws(() => loadConfig());
});

test("Codex/Claude hook uses user plugin JSON, ignores retired env and repository config", t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "guard-hook-config-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const repo = path.join(home, "repo"), white = path.join(home, "white.csv"), black = path.join(home, "black.csv");
  fs.mkdirSync(repo); fs.mkdirSync(path.join(home, ".repo-guard"));
  const env = { PATH: process.env.PATH, HOME: home, USERPROFILE: home, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
    REPO_GUARD_POLICY_MODE: "blacklist", REPO_GUARD_BLACKLIST_CSV: black, REPO_GUARD_WHITELIST_CSV: white, REPO_GUARD_FORBIDDEN_MARKER: ".ignored", REPO_GUARD_REMOTE: "missing" };
  const git = args => assert.equal(spawnSync("git", ["-C", repo, ...args], { env }).status, 0);
  git(["init"]); git(["remote", "add", "upstream", "https://git.example.invalid/team/demo"]);
  fs.writeFileSync(white, "repo\nhttps://git.example.invalid/team/demo\n");
  fs.writeFileSync(black, "repo\n");
  const configFile = path.join(home, ".repo-guard/config.json");
  const write = value => fs.writeFileSync(configFile, JSON.stringify(value));
  // A repository-controlled JSON file cannot weaken the user policy.
  fs.mkdirSync(path.join(repo, ".repo-guard"));
  fs.writeFileSync(path.join(repo, ".repo-guard/config.json"), JSON.stringify({ policyMode: "blacklist", blacklistCsv: black }));
  const run = host => {
    const result = spawnSync(process.execPath, [path.join(source, "scripts/host-hook.mjs"), "--host", host, "--event", "tool.before"], {
      cwd: repo, env, encoding: "utf8", input: JSON.stringify({ hook_event_name: "PreToolUse", cwd: repo, tool_name: "Bash", tool_input: { command: "pwd" } }),
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout).hookSpecificOutput?.permissionDecision ?? "allow";
  };
  for (const host of ["codex", "claude"]) {
    write({ remote: "upstream" }); assert.equal(run(host), "deny", "retired env cannot supply whitelist or change remote");
    write({ remote: "upstream", whitelistCsv: white, forbiddenMarker: ".no-ai" }); assert.equal(run(host), "allow");
    fs.writeFileSync(path.join(home, ".no-ai"), ""); assert.equal(run(host), "deny"); fs.unlinkSync(path.join(home, ".no-ai"));
    write({ remote: "upstream", policyMode: "blacklist", blacklistCsv: black }); assert.equal(run(host), "allow");
    fs.writeFileSync(black, "repo\nhttps://git.example.invalid/team/demo\n"); assert.equal(run(host), "deny");
    fs.writeFileSync(black, "repo\n");
  }
});
