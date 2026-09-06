import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildHosts, validateBuiltHost, isBuildCurrent, SOURCE_ROOT } from "./build.mjs";
import { HOSTS, loadManifest } from "./core/manifest.mjs";

export { HOSTS };
// Public build inputs only: never recursively copy the checkout (policy/config
// files may live alongside it). Keep aligned with build.mjs's input allowlist.
const STAGING_INPUTS = ["LICENSE", "NOTICE", "agent-plugin.json", "scripts/host-hook.mjs", "opencode.mjs", "src/build.mjs",
  "src/plugin.mjs", "src/core/manifest.mjs", "src/core/dispatch.mjs", "src/core/protocol.mjs",
  "src/guard.mjs", "src/config.mjs", "src/forbidden-path.mjs", "src/whitelist.mjs", "src/git-info.mjs", "src/git-url.mjs", "src/csv-parser.mjs",
  "src/command-parser.mjs", "src/logger.mjs", "src/mode.mjs", "src/opencode-tool.mjs"];
const MESSAGES = Object.freeze({
  command: "原生命令失败或超时；未输出宿主 stdout/stderr，请在宿主中检查",
  schema: "原生状态结构未知；无法安全确认安装状态",
  conflict: "发现同名插件或 marketplace 的不同来源／作用域；拒绝自动覆盖",
  disabled: "插件已禁用；请在宿主显式启用后重试，不自动修改禁用策略",
  unknown: "插件来源、版本、启用状态或加载状态未能核实；请在宿主中检查",
  postcheck: "原生命令执行后状态未满足目标；安装尚未验证完成，请在宿主中检查",
  dependencies: "OpenCode 本地 package 的 SDK 依赖未就绪或版本不符",
  local: "公开 manifest、构建或安装收据检查失败；未输出文件内容或异常路径",
  capability: "宿主 CLI 缺少所需原生命令参数；未执行安装变更",
  busy: "该宿主已有安装操作或未清理的锁；请确认没有运行中的安装后处理",
});
class InstallError extends Error {
  constructor(code) { super(MESSAGES[code]); this.code = code; }
}
function fail(code) { throw new InstallError(code); }
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
export function selectHosts(hosts) {
  if (!Array.isArray(hosts) || !hosts.length || hosts.some(host => !HOSTS.includes(host))) throw new Error("Invalid hosts");
  return [...new Set(hosts)];
}
function result(host, status, message, details = {}) {
  return { host, status, changed: status === "changed", message, details };
}
function identity(root, manifest, host) {
  const marketplace = `${manifest.name}-local-${host}`;
  const marketRoot = path.join(root, "dist", host);
  return { marketplace, marketRoot, selector: `${manifest.name}@${marketplace}`,
    pluginRoot: host === "opencode" ? path.join(marketRoot, "package") : path.join(marketRoot, "plugins", manifest.name) };
}
function removal(host, selector) {
  return host === "codex" ? [host, "plugin", "remove", selector]
    : [host, "plugin", "uninstall", selector, "--scope", "user", "--keep-data"];
}

// The plan is deliberately independent of native state and build existence.
export function nativePlans(root, manifest, hosts, action = "install") {
  return selectHosts(hosts).map(host => {
    const id = identity(root, manifest, host);
    if (action === "uninstall") return host === "opencode"
      ? { host, commands: [], manual: "OpenCode 无原生卸载命令；请手动移除对应 plugin[] 项，安装器不修改配置。" }
      : { host, commands: [removal(host, id.selector)] };
    if (host === "opencode") return { host, commands: [
      ["npm", "install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false"],
      [host, "plugin", pathToFileURL(id.pluginRoot).href, "--global"],
    ], commandCwds: [id.pluginRoot, root], prerequisites: ["build", "validate"],
    update: "精确同源已注册时只更新本地 package 和依赖；不重复写入宿主配置" };
    return { host, commands: [[host, "plugin", "marketplace", "add", id.marketRoot],
      [host, "plugin", host === "codex" ? "add" : "install", id.selector,
        ...(host === "claude" ? ["--scope", "user"] : [])]],
    prerequisites: ["build", "validate"],
    refresh: [...(host === "claude" ? [[host, "plugin", "marketplace", "update", id.marketplace]] : []), removal(host, id.selector)],
    update: "精确同源已安装时原生卸载／重装，保留 Claude 插件数据；逐宿主非原子，失败保留结果" };
  });
}

function localPath(value) {
  if (typeof value !== "string") return null;
  try {
    if (value.startsWith("file:")) return path.resolve(fileURLToPath(value));
    return path.isAbsolute(value) ? path.resolve(value) : null;
  } catch { return null; }
}
function samePath(value, expected) { return localPath(value) === path.resolve(expected); }
function related(entry, name) {
  return [entry.name, entry.id, entry.pluginId].some(value => typeof value === "string"
    && (value === name || value.startsWith(`${name}@`)));
}
function marketplaceState(host, payload, id) {
  const entries = host === "codex" ? payload?.marketplaces : payload;
  if (!Array.isArray(entries) || entries.some(e => !object(e) || typeof e.name !== "string")) fail("schema");
  const own = entries.filter(e => e.name === id.marketplace);
  if (own.length > 1) fail("conflict");
  if (!own.length) return false;
  const e = own[0];
  if (host === "codex") {
    if (!object(e.marketplaceSource) || typeof e.marketplaceSource.source !== "string") fail("unknown");
    if (e.marketplaceSource.sourceType !== "local" || !samePath(e.marketplaceSource.source, id.marketRoot)
      || !samePath(e.root, id.marketRoot)) fail("conflict");
  } else {
    if (typeof e.source !== "string" || typeof e.path !== "string") fail("unknown");
    if (e.source !== "directory" || !samePath(e.path, id.marketRoot)) fail("conflict");
  }
  return true;
}
function pluginState(host, payload, manifest, id, marketExists, allowDisabled = false) {
  const entries = host === "codex" ? payload?.installed : payload;
  if (!Array.isArray(entries) || entries.some(e => !object(e)
    || ![e.name, e.id, e.pluginId].some(v => typeof v === "string"))) fail("schema");
  const own = entries.filter(e => related(e, manifest.name));
  if (!own.length) return { installed: false, marketExists };
  if (own.length !== 1) fail("conflict");
  const e = own[0];
  if (host === "codex") {
    if (e.pluginId !== id.selector || e.name !== manifest.name || e.marketplaceName !== id.marketplace) fail("conflict");
    if (e.installed !== true) fail("unknown");
    if (!object(e.source) || typeof e.source.path !== "string") fail("unknown");
    if (e.source.source !== "local" || !samePath(e.source.path, id.pluginRoot)) fail("conflict");
    if (e.marketplaceSource && (e.marketplaceSource.sourceType !== "local"
      || !samePath(e.marketplaceSource.source, id.marketRoot))) fail("conflict");
  } else if (e.id !== id.selector || e.scope !== "user") fail("conflict");
  if (!marketExists) fail("unknown");
  if (e.enabled === false && !allowDisabled) fail("disabled");
  if ((e.enabled !== true && !(allowDisabled && e.enabled === false)) || typeof e.version !== "string" || !/^\d+\.\d+\.\d+$/.test(e.version)
    || (e.errors !== undefined && (!Array.isArray(e.errors) || e.errors.length))) fail("unknown");
  return { installed: true, marketExists, version: e.version };
}
function openCodeState(payload, manifest, id) {
  if (!object(payload) || (payload.plugin !== undefined && !Array.isArray(payload.plugin))) fail("schema");
  let count = 0;
  for (const entry of payload.plugin || []) {
    const spec = Array.isArray(entry) ? entry[0] : entry;
    if (typeof spec !== "string" || (Array.isArray(entry) && (entry.length !== 2 || !object(entry[1])))) fail("schema");
    if (samePath(spec, id.pluginRoot)) {
      if (Array.isArray(entry) && entry[1].enabled === false) fail("disabled");
      if (Array.isArray(entry) && entry[1].enabled !== undefined && entry[1].enabled !== true) fail("unknown");
      count++;
      continue;
    }
    const local = localPath(spec);
    if (spec === manifest.name || spec.startsWith(`${manifest.name}@`)
      || (local && local.split(path.sep).some(part => [manifest.name, `${manifest.name}.js`, `${manifest.name}.mjs`].includes(part)))) fail("conflict");
  }
  if (count > 1) fail("conflict");
  return { installed: count === 1, version: count ? manifest.version : undefined };
}

// Only component-owned public build/receipt/dependency files are read directly.
function owned(root, relative) {
  const target = path.resolve(root, relative);
  if (!target.startsWith(`${root}${path.sep}`)) fail("local");
  let current = root;
  for (const part of ["", ...path.relative(root, target).split(path.sep)]) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) fail("local"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return target;
}
function readJson(root, relative) { return JSON.parse(fs.readFileSync(owned(root, relative), "utf8")); }
function buildDigest(root, host) {
  return createHash("sha256").update(fs.readFileSync(owned(root, `dist/${host}/build-info.json`))).digest("hex");
}
function targetDigest(host, env) {
  // A shared checkout must not reuse another Home/config target's install proof.
  // Store only a digest, never user paths or configuration contents.
  const keys = ["HOME", "USERPROFILE", "XDG_CONFIG_HOME", ...{
    codex: ["CODEX_HOME"], claude: ["CLAUDE_CONFIG_DIR"], opencode: ["OPENCODE_CONFIG_DIR", "OPENCODE_CONFIG"],
  }[host]];
  const context = keys.map(key => [key, env[key] || ""]);
  if (!env.HOME && !env.USERPROFILE) context.push(["home", os.homedir()]);
  return createHash("sha256").update(JSON.stringify(context)).digest("hex");
}
function receiptRelative(host, env) { return `dist/.native-install/${targetDigest(host, env)}/${host}.json`; }
function receipt(root, manifest, host, env) {
  return { schema_version: 1, host, name: manifest.name, version: manifest.version, buildDigest: buildDigest(root, host), targetDigest: targetDigest(host, env) };
}
function receiptCurrent(root, manifest, host, env) {
  try { return JSON.stringify(readJson(root, receiptRelative(host, env))) === JSON.stringify(receipt(root, manifest, host, env)); }
  catch { return false; }
}
function saveReceipt(root, manifest, host, env) {
  const target = owned(root, receiptRelative(host, env));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(receipt(root, manifest, host, env))}\n`, { flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, target);
  } finally { fs.rmSync(temporary, { force: true }); }
}
function dependenciesReady(root) {
  try {
    const pkg = readJson(root, "dist/opencode/package/package.json");
    const sdk = readJson(root, "dist/opencode/package/node_modules/@opencode-ai/plugin/package.json");
    return pkg.dependencies?.["@opencode-ai/plugin"] === "1.18.31"
      && sdk.name === "@opencode-ai/plugin" && sdk.version === "1.18.31";
  } catch { return false; }
}

export function runNative(action, values, options = {}) {
  const hosts = selectHosts(values);
  const root = path.resolve(options.root || options.sourceDir || SOURCE_ROOT);
  const runner = options.runner || spawnSync;
  const builder = options.buildHosts || buildHosts;
  const validator = options.validateBuiltHost || validateBuiltHost;
  const currentBuild = options.isBuildCurrent || isBuildCurrent;
  const env = options.env || process.env;
  if (!["plan", "status", "sync", "build", "validate", "install", "uninstall"].includes(action)) throw new Error("Invalid action");
  const apply = action === "sync" || options.apply === true;
  const results = [];
  const plans = [];
  for (const host of hosts) {
    let phase = "manifest", writesAttempted = false, lock, stage, backup, published = false, committed = false;
    const completedSteps = [];
    try {
      const manifest = loadManifest(root), id = identity(root, manifest, host);
      const details = { name: manifest.name, version: manifest.version, trust: "unverified",
        verification: "native-registration-and-public-build-receipt",
        activation: "重启宿主；安装与启用状态不代表 hooks 信任、运行时加载或防护效果已验证" };
      const call = (command, args, cwd = root, mutating = false) => {
        if (mutating) writesAttempted = true;
        let output;
        try { output = runner(command, args, { cwd, env, encoding: "utf8", timeout: 120000, maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }); }
        catch { fail("command"); }
        if (!output || output.error || output.status !== 0) fail("command");
        // OpenCode's yargs help is deliberately written to stderr. Use it only
        // for capability checks; never forward either native stream to users.
        return args.includes("--help") ? `${output.stdout || ""}\n${output.stderr || ""}` : output.stdout || "";
      };
      const jsonCommand = args => {
        const text = call(host, args);
        try { return JSON.parse(text); } catch { fail("schema"); }
      };
      const inspect = () => {
        if (host === "opencode") return openCodeState(jsonCommand(["debug", "config", "--pure"]), manifest, id);
        const market = marketplaceState(host, jsonCommand(["plugin", "marketplace", "list", "--json"]), id);
        return pluginState(host, jsonCommand(["plugin", "list", "--json"]), manifest, id, market, action === "uninstall");
      };
      const plan = nativePlans(root, manifest, [host], action === "uninstall" ? action : "install")[0];
      if (["plan", "install", "uninstall"].includes(action)) plans.push(plan);
      if (action === "plan" || (["install", "uninstall"].includes(action) && !apply)) {
        results.push(result(host, "planned", "仅生成原生命令计划；未构建、未查询宿主、未安装", { ...details, plan }));
        continue;
      }
      if (action === "uninstall" && host === "opencode") {
        results.push(result(host, "unsupported", plan.manual, { ...details, manual: plan.manual }));
        continue;
      }
      if (action === "validate") {
        phase = "validate"; validator(root, host);
        results.push(result(host, "current", "公开构建校验通过（不是原生安装状态）", { verification: "public-build-only" }));
        continue;
      }
      // Lock only apply/build; status and dry-run never write even a lock file.
      if (action !== "status") {
        phase = "lock";
        const lockPath = owned(root, `dist/.native-install/${host}.lock`);
        fs.mkdirSync(path.dirname(lockPath), { recursive: true });
        try { fs.closeSync(fs.openSync(lockPath, "wx", 0o600)); lock = lockPath; }
        catch (error) { if (error.code === "EEXIST") fail("busy"); throw error; }
      }
      if (action === "build") {
        phase = "build"; writesAttempted = true; builder({ root, hosts: [host] }); validator(root, host);
        results.push(result(host, "changed", "公开构建和校验完成；未调用原生安装", { verification: "public-build-only", pluginRoot: id.pluginRoot }));
        continue;
      }
      phase = "native-status";
      const before = inspect();
      const current = before.installed && before.version === manifest.version && currentBuild(root, host) === true
        && receiptCurrent(root, manifest, host, env) && (host !== "opencode" || dependenciesReady(root));
      if (action === "status" || (current && action !== "uninstall")) {
        results.push(result(host, current ? "current" : "planned", current
          ? "原生注册、版本、启用状态和公开构建收据一致；信任状态未验证"
          : "需要安装、更新构建／依赖或重新验证原生安装", { ...details, installed: before.installed }));
        continue;
      }
      if (action === "uninstall" && !before.installed) {
        fs.rmSync(owned(root, receiptRelative(host, env)), { force: true });
        results.push(result(host, "current", "精确插件未安装；无需卸载", details));
        continue;
      }
      // Check supported flags before destructive refresh. Never invent update/force flags.
      phase = "native-capabilities";
      const commands = action === "uninstall" ? plan.commands : [
        ...(before.installed && host !== "opencode" ? [removal(host, id.selector)] : []),
        ...(host === "claude" && before.marketExists ? [[host, "plugin", "marketplace", "update", id.marketplace]] : []),
        ...plan.commands.filter(command => command[0] === host),
      ];
      for (const command of commands) {
        const prefix = command.slice(1, host === "opencode" ? 2 : command[2] === "marketplace" ? 4 : 3);
        const help = call(host, [...prefix, "--help"]);
        if (!(host === "opencode" ? /opencode plugin\s+<module>/.test(help) : /Usage:/i.test(help))
          || command.filter(arg => arg.startsWith("--")).some(flag => !help.includes(flag))) fail("capability");
      }
      phase = "invalidate-receipt";
      // OpenCode's old proof stays valid for the old tree until publish commits.
      if (host !== "opencode") fs.rmSync(owned(root, receiptRelative(host, env)), { force: true });
      if (action === "uninstall") {
        phase = "native-uninstall";
        const [command, ...args] = plan.commands[0]; call(command, args, root, true);
        completedSteps.push("native-uninstall");
        phase = "postcheck"; if (inspect().installed) fail("postcheck");
        results.push(result(host, "changed", "精确插件原生卸载已复查；保留 marketplace 注册和插件数据", details));
        continue;
      }
      phase = "build";
      if (host === "opencode") {
        // Build and npm must not touch the registered, stable file: package.
        // Preparing a fresh tree also avoids copying unknown local payloads.
        writesAttempted = true;
        stage = fs.mkdtempSync(owned(root, "dist/.native-opencode-"));
        for (const relative of STAGING_INPUTS) {
          const target = owned(stage, relative);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.copyFileSync(owned(root, relative), target);
        }
        builder({ root: stage, hosts: [host] }); completedSteps.push("build");
        phase = "validate"; validator(stage, host);
        phase = "dependencies";
        const [command, ...args] = plan.commands[0]; call(command, args, identity(stage, manifest, host).pluginRoot, true);
        if (!dependenciesReady(stage)) fail("dependencies");
        // npm must not have changed the validated public payload.
        validator(stage, host);
        completedSteps.push("dependencies");
        phase = "publish";
        const target = owned(root, `dist/${host}`);
        if (fs.existsSync(target)) {
          const previous = owned(stage, "previous");
          fs.renameSync(target, previous); backup = previous;
        }
        fs.renameSync(owned(stage, `dist/${host}`), target); published = true;
        completedSteps.push("publish");
        if (!before.installed) { phase = "native-install"; call(host, plan.commands[1].slice(1), root, true); completedSteps.push("native-install"); }
      } else {
        if (!currentBuild(root, host)) { writesAttempted = true; builder({ root, hosts: [host] }); completedSteps.push("build"); }
        phase = "validate"; validator(root, host);
        if (!before.marketExists) {
          phase = "marketplace-add"; call(host, plan.commands[0].slice(1), root, true); completedSteps.push("marketplace-add");
        } else if (host === "claude") {
          // Claude caches the marketplace metadata; refresh only this verified local source.
          phase = "marketplace-update"; call(host, ["plugin", "marketplace", "update", id.marketplace], root, true); completedSteps.push("marketplace-update");
        }
        if (before.installed) {
          phase = "native-remove-for-refresh"; call(host, removal(host, id.selector).slice(1), root, true); completedSteps.push("native-remove-for-refresh");
          phase = "remove-postcheck"; if (inspect().installed) fail("postcheck");
        }
        phase = "native-install"; call(host, plan.commands[1].slice(1), root, true); completedSteps.push("native-install");
      }
      phase = "postcheck";
      const after = inspect();
      if (!after.installed || after.version !== manifest.version || currentBuild(root, host) !== true) fail("postcheck");
      phase = "receipt"; saveReceipt(root, manifest, host, env);
      committed = true;
      results.push(result(host, "changed", "原生安装／更新后已复查；信任与运行时防护仍需宿主验证", { ...details, completedSteps }));
    } catch (error) {
      if (!committed && (backup || published)) {
        try {
          const target = owned(root, `dist/${host}`);
          if (published) fs.rmSync(target, { recursive: true, force: true });
          if (backup) fs.renameSync(backup, target);
          completedSteps.push("rollback");
        } catch {
          // Retain the only old tree for manual recovery; never delete it.
          stage = undefined; phase = "rollback"; error = new InstallError("local");
        }
      }
      const code = error instanceof InstallError ? error.code : "local";
      results.push(result(host, "failed", MESSAGES[code], { code, phase, writesAttempted, completedSteps, trust: "unverified" }));
    } finally {
      if (stage) {
        try { fs.rmSync(stage, { recursive: true, force: true }); }
        catch { results[results.length - 1] = result(host, "failed", MESSAGES.local, { code: "local", phase: "cleanup", writesAttempted, completedSteps }); }
      }
      if (lock) {
        try { fs.unlinkSync(lock); }
        catch { results[results.length - 1] = result(host, "failed", MESSAGES.local, { code: "local", phase: "unlock", writesAttempted, completedSteps }); }
      }
    }
  }
  return { ok: results.every(item => !["failed", "unsupported"].includes(item.status)), action, apply, plans, results };
}
