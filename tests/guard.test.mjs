/**
 * tests/guard.test.mjs — 核心拦截逻辑测试。
 *
 * 使用真实 Git 仓库 + 本地 CSV 白名单验证拦截行为。
 */

import { guardRead as read, guardBash as bash, guardSessionStart as start } from "../src/guard.mjs";
const config = {};
const guardRead = (input, host) => read(input, host, false, config);
const guardBash = (input, host) => bash(input, host, false, config);
const guardSessionStart = (input, host) => start(input, host, config);
import { _resetForTest } from "../src/whitelist.mjs";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) { passed++; } else { failed++; console.error(`FAIL: ${label}`); }
}

function assertBlocked(result, label) {
  assert(result.decision === "block", `${label} — should be blocked`);
}

function assertNoSensitiveReason(result, label) {
  const reason = result.reason || "";
  assert(!reason.includes("git.example.invalid"), `${label} — reason should not contain repo URL`);
  assert(!reason.includes(tmpDir), `${label} — reason should not contain absolute temp path`);
  assert(!reason.includes("forbidden-repo"), `${label} — reason should not contain repo name`);
}

function assertPassed(result, label) {
  assert(!result.decision, `${label} — should pass (no decision field)`);
}

// Setup: create whitelist CSV + whitelisted repo + non-whitelisted repo
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-test-"));
const csvPath = path.join(tmpDir, "guard_whitelist.csv");

const whiteRepoDir = path.join(tmpDir, "allowed-repo");
const otherRepoDir = path.join(tmpDir, "other-repo");
const noGitDir = path.join(tmpDir, "no-git-dir");

function initRepo(dir, remote) {
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "app.ts"), "export const x = 1;\n");
  spawnSync("git", ["init"], { cwd: dir, encoding: "utf8" });
  spawnSync("git", ["config", "user.email", "test@test.com"], { cwd: dir, encoding: "utf8" });
  spawnSync("git", ["config", "user.name", "Test"], { cwd: dir, encoding: "utf8" });
  if (remote) spawnSync("git", ["remote", "add", "origin", remote], { cwd: dir, encoding: "utf8" });
  spawnSync("git", ["add", "."], { cwd: dir, encoding: "utf8" });
  spawnSync("git", ["commit", "-m", "init"], { cwd: dir, encoding: "utf8" });
}

initRepo(whiteRepoDir, "git@git.example.invalid:team/allowed-repo");
initRepo(otherRepoDir, "git@git.example.invalid:team/forbidden-repo");
fs.mkdirSync(noGitDir, { recursive: true });
fs.writeFileSync(path.join(noGitDir, "orphan.txt"), "orphan\n");

fs.writeFileSync(csvPath, `name,repo,details\nAllowed,https://git.example.invalid/team/allowed-repo,Synthetic test repository\n`, "utf8");
config.whitelistCsv = csvPath;
_resetForTest();

// ========== Read guard ==========

// Test 1: Read from whitelisted repo → pass
{
  const result = guardRead({
    session_id: "test-1",
    cwd: whiteRepoDir,
    tool_input: { file_path: path.join(whiteRepoDir, "src", "app.ts") },
  }, "claude");
  assertPassed(result, "Read whitelisted repo");
}

// Test 2: Read from non-whitelisted repo → block
{
  const result = guardRead({
    session_id: "test-2",
    cwd: otherRepoDir,
    tool_input: { file_path: path.join(otherRepoDir, "src", "app.ts") },
  }, "claude");
  assertBlocked(result, "Read non-whitelisted repo");
  assertNoSensitiveReason(result, "Read non-whitelisted repo");
}

// Test 3: Read from non-git dir → pass (no repo = no risk)
{
  const result = guardRead({
    session_id: "test-3",
    cwd: noGitDir,
    tool_input: { file_path: path.join(noGitDir, "orphan.txt") },
  }, "claude");
  assertPassed(result, "Read non-git dir (pass, no repo)");
}

// Test 4: Read missing file_path → block
{
  const result = guardRead({
    session_id: "test-4",
    cwd: whiteRepoDir,
    tool_input: {},
  }, "claude");
  assertBlocked(result, "Read missing file_path");
}

// ========== Bash guard ==========

// Test 5: Bash in whitelisted repo → pass
{
  const result = guardBash({
    session_id: "test-5",
    cwd: whiteRepoDir,
    tool_input: { command: "cat src/app.ts" },
  }, "claude");
  assertPassed(result, "Bash whitelisted repo");
}

// Test 6: Bash in non-whitelisted repo → block
{
  const result = guardBash({
    session_id: "test-6",
    cwd: otherRepoDir,
    tool_input: { command: "cat src/app.ts" },
  }, "claude");
  assertBlocked(result, "Bash non-whitelisted repo");
  assertNoSensitiveReason(result, "Bash non-whitelisted repo");
}

// Test 7: Bash with no file paths but cwd in whitelisted repo → pass
{
  const result = guardBash({
    session_id: "test-7",
    cwd: whiteRepoDir,
    tool_input: { command: "ls -la" },
  }, "claude");
  assertPassed(result, "Bash no paths whitelisted cwd");
}

// Test 8: Bash with no file paths but cwd in non-whitelisted repo → block
{
  const result = guardBash({
    session_id: "test-8",
    cwd: otherRepoDir,
    tool_input: { command: "ls -la" },
  }, "claude");
  assertBlocked(result, "Bash no paths non-whitelisted cwd");
}

// Test 8b: Bash with no file paths but cwd in non-git dir → pass
{
  const result = guardBash({
    session_id: "test-8b",
    cwd: noGitDir,
    tool_input: { command: "ls -la" },
  }, "claude");
  assertPassed(result, "Bash no paths non-git cwd (pass)");
}

// Test 8c: Bash from non-whitelisted cwd must block even if referenced path is whitelisted
{
  const result = guardBash({
    session_id: "test-8c",
    cwd: otherRepoDir,
    tool_input: { command: `cat ${path.join(whiteRepoDir, "src", "app.ts")}` },
  }, "claude");
  assertBlocked(result, "Bash non-whitelisted cwd with whitelisted absolute path");
  assertNoSensitiveReason(result, "Bash non-whitelisted cwd with whitelisted absolute path");
}

// Test 8d: Bash command name that is itself a non-whitelisted repo path must block
{
  const scriptPath = path.join(otherRepoDir, "src", "app.ts");
  const result = guardBash({
    session_id: "test-8d",
    cwd: whiteRepoDir,
    tool_input: { command: scriptPath },
  }, "claude");
  assertBlocked(result, "Bash first token path in non-whitelisted repo");
  assertNoSensitiveReason(result, "Bash first token path in non-whitelisted repo");
}

// Test 8e: Bash cd into a non-whitelisted repo must block the protected call
{
  const result = guardBash({
    session_id: "test-8e",
    cwd: whiteRepoDir,
    tool_input: { command: `cd ${otherRepoDir} && ls -la` },
  }, "claude");
  assertBlocked(result, "Bash effective cwd in non-whitelisted repo");
  assertNoSensitiveReason(result, "Bash effective cwd in non-whitelisted repo");
}

// ========== SessionStart guard ==========

// Test 9: SessionStart in whitelisted repo → pass
{
  const result = guardSessionStart({
    session_id: "test-9",
    cwd: whiteRepoDir,
  }, "claude");
  assertPassed(result, "SessionStart whitelisted repo");
}

// Test 10: SessionStart in non-whitelisted repo → block
{
  const result = guardSessionStart({
    session_id: "test-10",
    cwd: otherRepoDir,
  }, "claude");
  assertBlocked(result, "SessionStart non-whitelisted repo");
  assertNoSensitiveReason(result, "SessionStart non-whitelisted repo");
}

// Test 11: SessionStart in non-git dir → pass (no repo to check)
{
  const result = guardSessionStart({
    session_id: "test-11",
    cwd: noGitDir,
  }, "claude");
  assertPassed(result, "SessionStart non-git dir (pass, no repo)");
}

// Clean up
fs.rmSync(tmpDir, { recursive: true, force: true });
_resetForTest();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
