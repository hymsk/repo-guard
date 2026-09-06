import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRepoGuardModeTool } from "../src/opencode-tool.mjs";
import { isDisabled } from "../src/mode.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "repo-guard-tool-"));
delete process.env.REPO_GUARD_DISABLED_FILE;
process.env.REPO_GUARD_DIR = tmp;
// Structural SDK double; actual SDK registration is checked by test:host.
let schemaUsed = false;
const sdk = value => value;
sdk.schema = { enum: values => { assert.deepEqual(values, ["on", "off", "status"]); schemaUsed = true; return { describe: () => ({ schema: true }) }; } };
try {
  const tool = createRepoGuardModeTool(sdk);
  assert(schemaUsed);
  assert.equal(typeof await tool.execute({ action: "status" }, { sessionID: "a" }), "string");
  await assert.rejects(tool.execute({ action: "off" }, { sessionID: "a" }), /permission API/);
  await assert.rejects(tool.execute({ action: "off" }, { sessionID: "a", ask: async () => { throw new Error("denied"); } }), /denied/);
  assert(!isDisabled("a"));
  let asked = false;
  await tool.execute({ action: "off" }, { sessionID: "a", ask: async input => { assert.equal(input.permission, "repo_guard_disable"); asked = true; } });
  assert(asked && isDisabled("a"));
  assert(!isDisabled("b"));
  await tool.execute({ action: "on" }, { sessionID: "a" });
  assert(!isDisabled("a"));
  await assert.rejects(tool.execute({ action: "invalid" }, { sessionID: "a" }));
  await assert.rejects(tool.execute({ action: "off" }, {}));
  console.log("OpenCode mode tool: SDK schema, permission denial, string return and session isolation checks passed");
} finally { fs.rmSync(tmp, { recursive: true, force: true }); delete process.env.REPO_GUARD_DIR; }
