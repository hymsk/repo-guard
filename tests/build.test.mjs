import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildHosts, validateBuiltHost, isBuildCurrent } from "../src/build.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
test("fixed build inventory, private canary excluded, atomic failure and freshness", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guard-build-"));
  try {
    for (const name of ["LICENSE", "NOTICE", "agent-plugin.json", "src", "scripts", "opencode.mjs"]) fs.cpSync(path.join(root, name), path.join(tmp, name), { recursive: true });
    fs.writeFileSync(path.join(tmp, "white_typeA.csv"), "PRIVATE_CANARY_NEVER_SHIP");
    const result = buildHosts({ root: tmp });
    for (const host of ["codex", "claude", "opencode"]) {
      assert(isBuildCurrent(tmp, host)); validateBuiltHost(tmp, host);
      assert(!fs.existsSync(path.join(result.results[host], "white_typeA.csv")));
      assert.equal(fs.readFileSync(path.join(result.results[host], "LICENSE"), "utf8"), fs.readFileSync(path.join(root, "LICENSE"), "utf8"));
      assert(fs.existsSync(path.join(result.results[host], "NOTICE")));
      const packageJson = JSON.parse(fs.readFileSync(path.join(result.results[host], "package.json")));
      assert.equal(packageJson.license, "AGPL-3.0-or-later");
      assert.equal(packageJson.private, true, "generated package must not be publishable by accident");
      if (host === "codex") {
        const native = JSON.parse(fs.readFileSync(path.join(result.results[host], ".codex-plugin/plugin.json")));
        assert(native.interface.displayName);
        assert.equal(native.hooks, undefined);
        assert.deepEqual(native.interface.capabilities, ["Read"]);
      }
      const walk = dir => {
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, ent.name);
          if (ent.isDirectory()) walk(p);
          else { const text = fs.readFileSync(p, "utf8"); assert(!text.includes("PRIVATE_CANARY_NEVER_SHIP")); assert(!text.includes(tmp)); assert(!text.includes(root)); assert(!text.includes("Developer:")); }
        }
      };
      walk(path.join(tmp, "dist", host));
    }
    const before = fs.readFileSync(path.join(tmp, "dist/codex/build-info.json"), "utf8");
    const sdk = path.join(result.results.opencode, "node_modules/sdk");
    fs.mkdirSync(sdk, { recursive: true });
    fs.writeFileSync(path.join(sdk, "marker"), "live-dependency");
    buildHosts({ root: tmp, hosts: ["opencode"] });
    assert.equal(fs.readFileSync(path.join(sdk, "marker"), "utf8"), "live-dependency");
    fs.appendFileSync(path.join(tmp, "src/plugin.mjs"), "\n");
    assert.throws(() => buildHosts({ root: tmp, hosts: ["opencode"] }), /update safely/);
    assert.equal(fs.readFileSync(path.join(sdk, "marker"), "utf8"), "live-dependency");
    fs.unlinkSync(path.join(tmp, "src/plugin.mjs"));
    assert.throws(() => buildHosts({ root: tmp }));
    assert.equal(fs.readFileSync(path.join(tmp, "dist/codex/build-info.json"), "utf8"), before);
    assert(!isBuildCurrent(tmp, "codex"));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
