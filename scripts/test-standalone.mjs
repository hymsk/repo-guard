import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { exportSource } from "./export-source.mjs";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "repo-guard-standalone-"));
try {
  const target = path.join(tmp, "source"), home = path.join(tmp, "home");
  exportSource(target); fs.mkdirSync(home);
  const env = { PATH: process.env.PATH, HOME: home, USERPROFILE: home, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
    REPO_GUARD_DIR: path.join(home, "mode"), npm_config_cache: path.join(home, "npm-cache") };
  for (const args of [["run", "check"], ["test"], ["run", "build"], ["run", "validate"]]) {
    const result = spawnSync("npm", args, { cwd: target, env, stdio: "inherit", timeout: 180000 });
    if (result.error || result.status !== 0) throw new Error(`Standalone npm ${args.join(" ")} failed`);
  }
  console.log("Standalone public source checks passed; no native installation or model request performed.");
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
