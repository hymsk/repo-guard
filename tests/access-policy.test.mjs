import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { isAllowed as check } from "../src/whitelist.mjs";
import { checkForbiddenPaths as paths } from "../src/forbidden-path.mjs";
import handler from "../src/plugin.mjs";
import { normalizeHostInput } from "../src/core/protocol.mjs";
import { extractFilePathsFromCommand, isSafelyParseableCommand } from "../src/command-parser.mjs";
let config = {};
const isAllowed = remote => check(remote, config);
const checkForbiddenPaths = targets => paths(targets, config);
const handle = event => handler(event, { config });

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "guard-access-"));
  config = {};
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}

test("mutually exclusive whitelist/blacklist modes and fail-closed active policy reload", t => {
  const root = fixture(t), white = path.join(root, "white.csv"), black = path.join(root, "black.csv");
  const a = "https://git.example.invalid/team/a", b = "https://git.example.invalid/team/b";
  config.whitelistCsv = white;
  fs.writeFileSync(white, `name,repo,details\nAllowed,${a},Example\n`);
  assert(isAllowed(a)); assert(!isAllowed(b));
  config.blacklistCsv = black;
  assert(isAllowed(a), "inactive missing blacklist is ignored");
  fs.writeFileSync(black, `details,repo,name\nIgnored,git@git.example.invalid:team/a.git,Denied\n`);
  assert(isAllowed(a), "whitelist mode ignores a matching blacklist");
  fs.writeFileSync(black, "broken"); assert(isAllowed(a), "inactive malformed blacklist is ignored");
  fs.writeFileSync(black, `repo\n${a}\n`);
  config.policyMode = "blacklist";
  assert(!isAllowed(a)); assert(isAllowed(b));
  assert(isAllowed("https://other.example.invalid/team/a"), "blacklist uses full host");
  assert(isAllowed("ssh://git@git.example.invalid:443/team/a"), "blacklist preserves port");
  assert(!isAllowed("malformed"));
  fs.writeFileSync(white, "broken"); assert(isAllowed(b), "inactive malformed whitelist is ignored");
  fs.unlinkSync(white); assert(isAllowed(b), "blacklist mode does not read whitelist");
  delete config.whitelistCsv; assert(isAllowed(b), "blacklist mode can omit whitelist entirely");
  for (const invalid of ["", "repo,repo\na,b\n", "repo_path\nteam/a\n", "repo\nhttp://git.example.invalid/team/a\n", "repo\n\"\"\n", `repo\n${a}\n\"broken`]) {
    fs.writeFileSync(black, invalid); assert(!isAllowed(b), "invalid deny policy must not become empty allow-all");
  }
  fs.writeFileSync(black, "repo\n"); assert(isAllowed(b), "explicit header-only blacklist permits unmatched repositories");
  const stamp = fs.statSync(black).mtime;
  fs.writeFileSync(black, `repo\n${b}\n`); fs.utimesSync(black, stamp, stamp); assert(!isAllowed(b));
  fs.unlinkSync(black); assert(!isAllowed(b));
  delete config.blacklistCsv; assert(!isAllowed(b));
  config.blacklistCsv = "relative.csv"; assert(!isAllowed(b));
  config.policyMode = "typo"; assert(!isAllowed(a));
});

test("directory, ancestor, custom marker, deletion, symlink and missing descendant checks", t => {
  const root = fixture(t), deep = path.join(root, "parent/child/deep"), sibling = path.join(root, "sibling");
  fs.mkdirSync(deep, { recursive: true }); fs.mkdirSync(sibling);
  const file = path.join(deep, "data"); fs.writeFileSync(file, "example");
  const allowed = target => checkForbiddenPaths([target]).allowed;
  assert(allowed(file));
  for (const dir of [deep, path.dirname(deep), path.join(root, "parent")]) {
    const marker = path.join(dir, ".ai-forbidden"); fs.writeFileSync(marker, "contents do not matter");
    assert(!allowed(file)); assert(!allowed(deep)); assert(!allowed(path.join(deep, "missing/child/file")));
    assert(allowed(sibling)); fs.unlinkSync(marker); assert(allowed(file));
  }
  const marker = path.join(root, "parent/.ai-forbidden");
  fs.symlinkSync(path.join(root, "missing-marker-target"), marker); assert(!allowed(file)); fs.unlinkSync(marker);
  fs.mkdirSync(marker); assert(!allowed(file)); fs.rmdirSync(marker);
  const alias = path.join(sibling, "alias"); fs.symlinkSync(file, alias);
  fs.writeFileSync(marker, ""); assert(!allowed(alias)); fs.unlinkSync(marker);
  const dirAlias = path.join(sibling, "dir-alias"); fs.symlinkSync(deep, dirAlias);
  fs.writeFileSync(marker, ""); assert(!allowed(path.join(dirAlias, "missing/file"))); fs.unlinkSync(marker);
  fs.writeFileSync(path.join(sibling, ".ai-forbidden"), ""); assert(!allowed(alias), "lexical ancestors also apply");
  fs.unlinkSync(path.join(sibling, ".ai-forbidden"));
  fs.symlinkSync(path.join(root, "missing"), path.join(sibling, "dangling")); assert(!allowed(path.join(sibling, "dangling")));
  config.forbiddenMarker = ".no-ai";
  fs.writeFileSync(marker, ""); assert(allowed(file), "custom name replaces default");
  fs.writeFileSync(path.join(root, "parent/.no-ai"), ""); assert(!allowed(file));
  for (const invalid of ["", "..", "../marker", "a/b", "a\\b", "*"]) {
    config.forbiddenMarker = invalid; assert(!allowed(file));
  }
});

test("real Git repositories obey blacklist and ancestor markers across three host handlers", async t => {
  const root = fixture(t), repo = path.join(root, "repo"), black = path.join(root, "black.csv");
  fs.mkdirSync(repo);
  const git = args => assert.equal(childProcess.spawnSync("git", ["-C", repo, ...args]).status, 0);
  git(["init"]); git(["remote", "add", "origin", "git@git.example.invalid:team/demo.git"]);
  config.policyMode = "blacklist";
  config.blacklistCsv = black;
  for (const host of ["codex", "claude", "opencode"]) {
    const event = normalizeHostInput(host, "tool.before", { cwd: repo, tool_name: "Bash", tool_input: { command: "pwd" } });
    fs.writeFileSync(black, "repo\nhttps://other.example.invalid/team/demo\n");
    assert.equal((await handle(event)).action, "allow");
    fs.writeFileSync(black, "repo\nhttps://git.example.invalid/team/demo\n");
    assert.equal((await handle(event)).action, "deny");
    fs.writeFileSync(black, "repo\n");
    fs.writeFileSync(path.join(root, ".ai-forbidden"), "");
    assert.equal((await handle(event)).action, "deny", "marker above Git root applies");
    fs.unlinkSync(path.join(root, ".ai-forbidden"));
    assert.equal((await handle(event)).action, "allow");
  }
});

test("root-level marker and metadata errors fail closed without reading marker content", t => {
  const root = fixture(t), original = fs.lstatSync;
  t.mock.method(fs, "readFileSync", () => { throw new Error("Must not read marker content"); });
  const markerAtRoot = path.join(path.parse(root).root, ".ai-forbidden");
  t.mock.method(fs, "lstatSync", file => {
    if (file === markerAtRoot) return { isSymbolicLink: () => false };
    return original(file);
  });
  assert(!checkForbiddenPaths([path.join(root, "file")]).allowed);
  t.mock.restoreAll();
  t.mock.method(fs, "lstatSync", () => { throw Object.assign(new Error("Denied"), { code: "EACCES" }); });
  assert(!checkForbiddenPaths([root]).allowed);
});

test("all hosts preflight all Read/Bash paths before any Git access", async t => {
  const root = fixture(t), safe = path.join(root, "safe"), blocked = path.join(root, "blocked");
  fs.mkdirSync(safe); fs.mkdirSync(blocked); fs.writeFileSync(path.join(blocked, ".ai-forbidden"), "");
  fs.writeFileSync(path.join(blocked, "secret"), "example");
  fs.symlinkSync(path.join(blocked, "secret"), path.join(safe, "secret"));
  fs.mkdirSync(path.join(blocked, "child"));
  fs.symlinkSync(path.join(blocked, "child"), path.join(safe, "link"));
  const traversal = `${safe}/link/../secret`;
  let gitCalls = 0;
  t.mock.method(childProcess, "spawnSync", () => { gitCalls++; throw new Error("Git must not be called"); });
  syncBuiltinESMExports(); t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  for (const host of ["codex", "claude", "opencode"]) {
    for (const mode of ["whitelist", "blacklist"]) {
      config.policyMode = mode;
      const raw = { cwd: safe, tool_name: "Read", tool_input: host === "opencode" ? { filePath: path.join(blocked, "secret") } : { file_path: path.join(blocked, "secret") } };
      assert.equal((await handle(normalizeHostInput(host, "tool.before", raw))).action, "deny");
      raw.tool_input = host === "opencode" ? { filePath: traversal } : { file_path: traversal };
      assert.equal((await handle(normalizeHostInput(host, "tool.before", raw))).action, "deny");
      for (const input of [{ command: "pwd", workdir: blocked }, { command: `cat ${blocked}/secret` }, { command: "cat secret" }, { command: `cd ${blocked} && cd ${safe} && pwd` }, { command: `cat ${traversal}` }, { command: "pwd", workdir: `${safe}/link/..` }, { command: `cd ${safe}/link/.. && pwd` }]) {
        assert.equal((await handle(normalizeHostInput(host, "tool.before", { cwd: safe, tool_name: "Bash", tool_input: input }))).action, "deny");
      }
    }
  }
  const batch = normalizeHostInput("opencode", "tool.before", { cwd: safe, tool: "batch", tool_input: { tool_calls: [
    { tool: "bash", parameters: { command: "pwd" } },
    { tool: "read", parameters: { filePath: path.join(blocked, "secret") } },
  ] } });
  assert.equal((await handle(batch)).action, "deny");
  assert.equal(gitCalls, 0, "marker preflight must precede even Git availability checks");
});

test("conservative Bash preflight rejects syntax it cannot safely parse", () => {
  for (const command of [
    "cat</blocked/secret",
    "cat >/blocked/secret",
    "cd /blocked&&pwd",
    "cat /blocked/secret | tee /tmp/copy",
    "sh -c 'cat /blocked/secret'",
    "echo $(cat /blocked/secret)",
    "tool --file=/blocked/secret",
    "cat /blocked/secret\\ path",
    "cat /blocked/*",
  ]) {
    assert.equal(isSafelyParseableCommand(command), false, command);
    assert.equal(extractFilePathsFromCommand(command, "/safe").safe, false, command);
  }
  assert.equal(isSafelyParseableCommand("cat /safe/file"), true);
  assert.equal(extractFilePathsFromCommand("cat /safe/file", "/safe").safe, true);
});
