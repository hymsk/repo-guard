import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { isAllowed as check, getStats as stats, _resetForTest } from "../src/whitelist.mjs";
const config = {};
const isAllowed = remote => check(remote, config);
const getStats = () => stats(config);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "repo-policy-"));
const csv = path.join(tmp, "policy.csv");
const remote = "https://git.example.invalid/team/demo.git";
const write = text => fs.writeFileSync(csv, text);
try {
  config.whitelistCsv = csv;
  for (const text of [
    `name,repo,details\nDemo,${remote},Example\n`,
    `details,name,repo\nExample,Demo,${remote}\n`,
    `repo\n${remote}\n`,
    `\uFEFFname,repo,details\r\nDemo,"${remote}","Line one\r\nLine two, quoted"\r\n`,
  ]) {
    write(text); assert(isAllowed(remote));
    assert(isAllowed("git@git.example.invalid:team/demo.git"));
    assert(isAllowed("ssh://git@GIT.EXAMPLE.INVALID:22/team/demo"));
    for (const other of ["https://other.example.invalid/team/demo", "https://sub.git.example.invalid/team/demo", "https://git.example.invalid/Team/demo", "https://git.example.invalid/team/demo-more", "https://git.example.invalid/team/demo/child", "ssh://git@git.example.invalid:443/team/demo", "team/demo"]) assert(!isAllowed(other), other);
  }
  write(`name,repo,details,repo_path\nIgnored,${remote},https://evil.example.invalid/team/demo,other/path\n`);
  assert(isAllowed(remote));
  assert(!isAllowed("https://evil.example.invalid/team/demo"));
  assert(!isAllowed("https://git.example.invalid/other/path"));
  for (const invalid of [
    "", "repo_path\nteam/demo\n", `Repo\n${remote}\n`, `repo,repo\n${remote},${remote}\n`,
    `name,repo,details\nDemo,${remote}\n`, `repo\n"${remote}`, `repo\n"${remote}"trailing\n`,
    `repo\n${remote}\n"unclosed`,
  ]) { write(invalid); assert(!isAllowed(remote), "invalid policy must revoke all entries"); }
  write(`name,repo,details\nMissing,,Ignored\nInvalid,http://git.example.invalid/team/demo,Ignored\nGood,${remote},Allowed\n`);
  assert(isAllowed(remote)); assert.equal(getStats().allowSetSize, 1);
  write("repo\nssh://git@git.example.invalid:443/team/demo.git\n");
  assert(isAllowed("ssh://git@git.example.invalid:443/team/demo"));
  assert(!isAllowed(remote));
  write(`repo\n${remote}\n`); assert(isAllowed(remote));
  fs.unlinkSync(csv); assert(!isAllowed(remote));
  write(`repo\n${remote}\n`); assert(isAllowed(remote));
  const stamp = fs.statSync(csv).mtime;
  write("repo\nhttps://other.example.invalid/team/demo\n"); fs.utimesSync(csv, stamp, stamp);
  assert(!isAllowed(remote));
  // The documented English example is directly loadable without repo_path.
  config.whitelistCsv = fileURLToPath(new URL("../examples/whitelist.csv", import.meta.url));
  assert(isAllowed("git@git.example.invalid:example/demo-app.git"));
  assert(isAllowed("https://git.example.invalid/example/shared-library"));
  config.whitelistCsv = "relative.csv"; assert(!isAllowed(remote));
  console.log("Whitelist: repo-only headers, exact matching, invalid policy revocation, reload and example checks passed");
} finally {
  _resetForTest(); fs.rmSync(tmp, { recursive: true, force: true });
}
