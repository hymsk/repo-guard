import assert from "node:assert/strict";
import { repositoryKey, normalizeGitUrl } from "../src/git-url.mjs";

const key = "git.example.invalid/team/demo";
for (const address of [
  "https://git.example.invalid/team/demo", "https://GIT.EXAMPLE.INVALID/team/demo.git/",
  "https://git.example.invalid:443/team/demo.git", "ssh://git@git.example.invalid/team/demo.git",
  "ssh://user@git.example.invalid:22/team/demo.git", "git@git.example.invalid:team/demo.git",
  "https://user:password@git.example.invalid/team/demo.git", " https://git.example.invalid/team/demo ",
]) assert.equal(repositoryKey(address), key, address);
assert.equal(normalizeGitUrl("git@git.example.invalid:team/demo.git"), `https://${key}`);
for (const address of [
  "https://other.example.invalid/team/demo", "https://sub.git.example.invalid/team/demo",
  "https://git.example.invalid/Team/demo", "https://git.example.invalid/team/demo-more",
  "https://git.example.invalid/team/demo/child", "https://git.example.invalid:8443/team/demo",
  "ssh://git@git.example.invalid:443/team/demo", "https://git.example.invalid:22/team/demo",
]) assert.notEqual(repositoryKey(address), key, address);
assert.equal(repositoryKey("https://git.example.invalid:8443/team/demo"), repositoryKey("ssh://git@git.example.invalid:8443/team/demo"));
assert.equal(repositoryKey("ssh://git@[2001:db8::1]:22/team/demo.git"), "[2001:db8::1]/team/demo");
assert.equal(repositoryKey("git@[2001:db8::1]:team/demo.git"), "[2001:db8::1]/team/demo");
for (const address of [
  null, "", "team/demo", "http://git.example.invalid/team/demo", "ftp://git.example.invalid/team/demo",
  "https://git.example.invalid", "https://git.example.invalid/", "https://git.example.invalid/.git",
  "https://git.example.invalid/team/demo?x=1", "https://git.example.invalid/team/demo#fragment",
  "https://git.example.invalid/team/../demo", "https://git.example.invalid/team/./demo",
  "https://git.example.invalid/team//demo", "https://git.example.invalid/team/%64emo",
  "https://git.example.invalid/team\\demo", "https://git.example.invalid/team/demo\n",
  "https://git.example.invalid./team/demo", "https://git.example.invalid:0/team/demo",
  "https://git.example.invalid:65536/team/demo", "https://git.example.invalid:/team/demo",
  "ssh://git:password@git.example.invalid/team/demo", "ssh://git@git.example.invalid/~user/demo",
  "git@git.example.invalid:/team/demo", "https://127.1/team/demo",
]) assert.equal(repositoryKey(address), null, String(address));
console.log("Git URL: strict authority/path, HTTPS/SSH equivalence, case, ports and malformed inputs passed");
