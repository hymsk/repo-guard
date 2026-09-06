/** Opt-in native installation in a relocated, isolated HOME; no model requests. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildHosts, SDK_VERSION } from "../src/build.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "repo-guard-native-"));
const env = { PATH: process.env.PATH, HOME: tmp, XDG_CONFIG_HOME: path.join(tmp, "config"),
  XDG_DATA_HOME: path.join(tmp, "data"), XDG_CACHE_HOME: path.join(tmp, "cache"), XDG_STATE_HOME: path.join(tmp, "state"),
  OPENCODE_CONFIG_DIR: path.join(tmp, "config/opencode"), OPENCODE_DISABLE_AUTOUPDATE: "1",
  OPENCODE_DISABLE_DEFAULT_PLUGINS: "1", OPENCODE_DISABLE_MODELS_FETCH: "1",
  REPO_GUARD_LOG_LEVEL: "debug", REPO_GUARD_LOG_FILE: path.join(tmp, "guard.log"),
  REPO_GUARD_DIR: path.join(tmp, "mode"),
  npm_config_cache: path.join(tmp, "npm-cache"), npm_config_fetch_retries: "0", npm_config_fetch_timeout: "20000" };
function run(command, args, cwd = tmp) {
  console.log(`Host probe: ${command} ${args[0]}`);
  const started = Date.now();
  const r = spawnSync(command, args, { env, cwd, encoding: "utf8", timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  if (r.status !== 0) console.error((r.stderr || r.stdout || String(r.error || "unknown failure"))
    .replaceAll(tmp, "<isolated-home>").replace(/https?:\/\/\S+/g, "<url>").slice(-2500));
  assert.equal(r.status, 0, `${command} ${args[0]} failed; private configuration output suppressed`);
  console.log(`Host probe completed: ${command} ${args[0]} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  return r;
}
try {
  const { results } = buildHosts({ root, hosts: ["opencode"] });
  const relocated = path.join(tmp, "relocated-package");
  fs.cpSync(results.opencode, relocated, { recursive: true });
  run("npm", ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false"], relocated);
  const version = run("opencode", ["--version"]).stdout.trim();
  // OpenCode waits for a separate SDK install in its config directory before
  // loading external plugins. A package-local SDK does not satisfy that gate.
  // Prepare REAL dependencies and the npm lockfile in this isolated HOME only;
  // do not seed an empty node_modules or fabricate an install-complete lockfile.
  const hostConfigDir = env.OPENCODE_CONFIG_DIR;
  fs.mkdirSync(hostConfigDir, { recursive: true });
  fs.writeFileSync(path.join(hostConfigDir, "package.json"), JSON.stringify({
    name: "repo-guard-isolated-host", private: true, dependencies: { "@opencode-ai/plugin": SDK_VERSION },
  }));
  console.log("Host prerequisite: prepare isolated config SDK and package-lock.json");
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], hostConfigDir);
  const installedSdk = JSON.parse(fs.readFileSync(path.join(hostConfigDir, "node_modules/@opencode-ai/plugin/package.json")));
  assert.equal(installedSdk.version, SDK_VERSION);
  const lock = JSON.parse(fs.readFileSync(path.join(hostConfigDir, "package-lock.json")));
  assert.equal(lock.packages[""].dependencies["@opencode-ai/plugin"], SDK_VERSION);
  assert.equal(lock.packages["node_modules/@opencode-ai/plugin"].version, SDK_VERSION);
  const { pathToFileURL } = await import("node:url");
  run("opencode", ["plugin", pathToFileURL(relocated).href, "--global"]);
  // Exercise the native tuple configuration syntax in this isolated host only.
  fs.writeFileSync(path.join(hostConfigDir, "opencode.json"), JSON.stringify({
    plugin: [[pathToFileURL(relocated).href, { policyMode: "whitelist", forbiddenMarker: ".native-no-ai", remote: "origin" }]],
  }));
  // Load the exact relocated package (real SDK) and exercise registered hooks/tools.
  run(process.execPath, ["--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import { pathToFileURL } from 'node:url';
    const mod = await import(pathToFileURL(process.argv[1]).href);
    assert.deepEqual(Object.keys(mod), ['default']);
    const hooks = await mod.default({directory:process.cwd()}, {forbiddenMarker:'.native-no-ai'});
    const tool = hooks.tool.repo_guard_mode;
    assert.equal(tool.args.action.parse('status'), 'status');
    assert.throws(()=>tool.args.action.parse('invalid'));
    assert.equal(typeof await tool.execute({action:'status'},{sessionID:'test'}),'string');
    await assert.rejects(tool.execute({action:'off'},{sessionID:'test',ask:async()=>{throw new Error('denied')}}));
    await assert.rejects(hooks['tool.execute.before']({tool:'read',sessionID:'test'},{args:{}}));
    await hooks['tool.execute.before']({tool:'other',sessionID:'test'},{args:{}});
    fs.writeFileSync('.native-no-ai', '');
    const readInput = {tool:'read',sessionID:'test'};
    const readOutput = {args:{filePath:process.cwd()+'/example'}};
    await assert.rejects(hooks['tool.execute.before'](readInput,readOutput));
    await tool.execute({action:'off'},{sessionID:'test',ask:async()=>{}});
    await hooks['tool.execute.before'](readInput,readOutput);
    await tool.execute({action:'on'},{sessionID:'test'});
    await assert.rejects(hooks['tool.execute.before'](readInput,readOutput));
    const independent = await mod.default({directory:process.cwd()}, {forbiddenMarker:'.different-marker'});
    await independent['tool.execute.before'](readInput,readOutput);
    const invalid = await mod.default({directory:process.cwd()}, {policyMode:'typo'});
    await assert.rejects(invalid['tool.execute.before'](readInput,readOutput));
    fs.unlinkSync('.native-no-ai');
  `, path.join(relocated, "opencode.mjs")]);
  console.log("Relocated package: real SDK tool schema, permission rejection and hook dispatch passed");
  // Only logs written by the native host count as host initialization evidence.
  fs.rmSync(env.REPO_GUARD_LOG_FILE, { force: true });
  run("opencode", ["debug", "config", "--print-logs", "--log-level", "DEBUG"]);
  assert(fs.readFileSync(env.REPO_GUARD_LOG_FILE, "utf8").includes("plugin_ready"));
  console.log(`OpenCode ${version}: relocated native file installation, initialization, real SDK tool and hook tests passed`);
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
