/**
 * tests/mode.test.mjs — repo-guard 开关状态（标记文件）测试。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isDisabled, setDisabled, getDisabledPath } from "../src/mode.mjs";

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) { passed++; } else { failed++; console.error(`FAIL: ${label}`); }
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "repo-guard-mode-test-"));
const flagFile = path.join(tmpDir, "opencode-disabled");
process.env.REPO_GUARD_DISABLED_FILE = flagFile;

assert(!fs.existsSync(flagFile), "marker file starts absent");
assert(!isDisabled(), "default state is enabled (no marker file)");

setDisabled(true);
assert(fs.existsSync(flagFile), "setDisabled(true) creates marker file");
assert(isDisabled(), "isDisabled() is true after off");

setDisabled(false);
assert(!fs.existsSync(flagFile), "setDisabled(false) removes marker file");
assert(!isDisabled(), "isDisabled() is false after on");

assert(getDisabledPath() === flagFile, "getDisabledPath resolves override");

const disabledViaUnlink = path.join(tmpDir, "manual");
fs.writeFileSync(disabledViaUnlink, "", "utf8");
process.env.REPO_GUARD_DISABLED_FILE = disabledViaUnlink;
assert(isDisabled(), "marker created manually (touch) disables guard");
fs.unlinkSync(disabledViaUnlink);
assert(!isDisabled(), "removing marker manually (rm) re-enables guard");
delete process.env.REPO_GUARD_DISABLED_FILE;

const sessionDir = path.join(tmpDir, "sessions");
process.env.REPO_GUARD_DIR = sessionDir;

const sessionA = "sess-a-123";
const sessionB = "sess-b-456";
assert(!isDisabled(sessionA), "session A starts enabled");
assert(!isDisabled(sessionB), "session B starts enabled");

setDisabled(true, sessionA);
assert(isDisabled(sessionA), "session A disabled by its own marker");
assert(!isDisabled(sessionB), "session B unaffected (isolated per-session)");
assert(fs.existsSync(path.join(sessionDir, "opencode-disabled-sess-a-123")), "session A marker created");

setDisabled(false, sessionA);
assert(!isDisabled(sessionA), "session A re-enabled");
assert(!isDisabled(sessionB), "session B still enabled");

setDisabled(true, sessionB);
assert(isDisabled(sessionB), "session B disabled");
assert(!isDisabled(sessionA), "session A unaffected by session B");

const weird = "bad/../path";
assert(getDisabledPath(weird) !== path.join(sessionDir, "opencode-disabled-bad/../path"), "unsafe session id is sanitized");

fs.rmSync(tmpDir, { recursive: true, force: true });
delete process.env.REPO_GUARD_DIR;

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
