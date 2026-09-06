import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exportSource } from "../scripts/export-source.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
test("public export is explicit, standalone, licensed and excludes local payloads", t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guard-export-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const source = path.join(tmp, "source"); exportSource(source);
  for (const name of ["private.csv", "export_repos.sh", ".env", "dist/cache", ".git/config", "node_modules/private"]) {
    const file = path.join(source, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, "PRIVATE_EXPORT_CANARY");
  }
  const output = path.join(tmp, "output"); const result = exportSource(output, source);
  const files = JSON.parse(fs.readFileSync(path.join(output, "public-files.json")));
  assert.equal(result.files, files.length);
  const pkg = JSON.parse(fs.readFileSync(path.join(output, "package.json")));
  assert.equal(pkg.license, "AGPL-3.0-or-later");
  assert.equal(pkg.private, true);
  assert.equal(pkg.version, JSON.parse(fs.readFileSync(path.join(output, "agent-plugin.json"))).version);
  for (const name of ["RELEASE.md", "BASE-LINEAGE.md"]) assert(files.includes(name), name);
  assert(!files.some(name => name.startsWith(".github/workflows/")), "release gates remain manual");
  for (const [name, command] of Object.entries(pkg.scripts)) {
    for (const match of command.matchAll(/(?:scripts|tests)\/[\w.-]+\.mjs/g)) {
      assert(files.includes(match[0]), `${name}: entry missing from public inventory`);
      assert(fs.statSync(path.join(output, match[0])).isFile());
    }
  }
  for (const file of files) assert(!fs.readFileSync(path.join(output, file), "utf8").includes("PRIVATE_EXPORT_" + "CANARY") || file === "tests/export-source.test.mjs");
  assert(!fs.existsSync(path.join(output, "export_repos.sh"))); assert(!fs.existsSync(path.join(output, ".git")));
  assert(fs.existsSync(path.join(output, "LICENSE")) && fs.existsSync(path.join(output, "NOTICE")));
  assert.throws(() => exportSource(output, source));
  assert.throws(() => exportSource(path.join(source, "nested"), source));
  fs.unlinkSync(path.join(source, "README.md")); fs.symlinkSync(path.join(root, "README.md"), path.join(source, "README.md"));
  assert.throws(() => exportSource(path.join(tmp, "symlink-output"), source));
  assert(!fs.existsSync(path.join(tmp, "symlink-output")));
});
