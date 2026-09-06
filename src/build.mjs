// Template lineage and intentional differences are documented in BASE-LINEAGE.md.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { loadManifest, HOSTS } from "./core/manifest.mjs";
export const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SDK_VERSION = "1.18.31";
const RUNTIME = ["LICENSE", "NOTICE", "agent-plugin.json", "scripts/host-hook.mjs", "opencode.mjs",
  "src/plugin.mjs", "src/core/manifest.mjs", "src/core/dispatch.mjs", "src/core/protocol.mjs",
  "src/guard.mjs", "src/config.mjs", "src/forbidden-path.mjs", "src/whitelist.mjs", "src/git-info.mjs", "src/git-url.mjs", "src/csv-parser.mjs",
  "src/command-parser.mjs", "src/logger.mjs", "src/mode.mjs", "src/opencode-tool.mjs"];
const BUILD_INPUTS = [...RUNTIME, "src/build.mjs"];

function safe(root, file) {
  const absolute = path.resolve(root, file);
  if (!absolute.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error("Path escapes root");
  let current = absolute;
  while (current !== path.resolve(root)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error("Symlink not allowed");
    current = path.dirname(current);
  }
  return absolute;
}
function json(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}
export function sourceDigest(root) {
  const hash = createHash("sha256");
  for (const file of [...BUILD_INPUTS].sort()) hash.update(file).update("\0").update(fs.readFileSync(safe(root, file))).update("\0");
  return hash.digest("hex");
}
export function buildHookConfig(host, manifest) {
  if (!["codex", "claude"].includes(host)) throw new Error("Invalid hook host");
  const variable = host === "claude" ? "CLAUDE_PLUGIN_ROOT" : "PLUGIN_ROOT";
  // POSIX wrapper maps module load failures/nonzero termination to blocking exit 2.
  // Node missing also becomes exit 2 via the shell fallback, rather than exit 127.
  const js = `const p=require("path"),c=require("child_process"),r=process.env.${variable};if(!r){console.error("repo-guard unavailable");process.exit(2)}const x=c.spawnSync(process.execPath,[p.join(r,"scripts","host-hook.mjs"),"--host","${host}","--event","tool.before"],{stdio:["inherit","pipe","pipe"],maxBuffer:1048576});if(x.error||x.status!==0){console.error("repo-guard unavailable");process.exit(2)}process.stdout.write(x.stdout);`;
  return { hooks: { PreToolUse: [{ matcher: "^(Read|Bash)$", hooks: [{ type: "command",
    command: `node -e '${js}' || { printf '%s\\n' 'repo-guard unavailable' >&2; exit 2; }`,
    timeout: 30, statusMessage: `Checking ${manifest.name}` }] }] } };
}
function runtime(root, destination) {
  for (const file of RUNTIME) {
    const target = path.join(destination, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(safe(root, file), target);
  }
}
function generate(root, host, m, out) {
  const pluginRoot = host === "opencode" ? path.join(out, "package") : path.join(out, "plugins", m.name);
  runtime(root, pluginRoot);
  json(path.join(pluginRoot, "package.json"), { name: m.name, version: m.version, description: m.description,
    author: m.author, license: "AGPL-3.0-or-later", private: true, type: "module", engines: { node: ">=22" },
    ...(host === "opencode" ? { main: "./opencode.mjs", exports: "./opencode.mjs", dependencies: { "@opencode-ai/plugin": SDK_VERSION } } : {}) });
  if (host === "opencode") return pluginRoot;
  json(path.join(pluginRoot, `.${host === "claude" ? "claude" : "codex"}-plugin/plugin.json`), {
    name: m.name, version: m.version, description: m.description, author: m.author,
    ...(host === "claude" ? { hooks: "./hooks/hooks.json" } : { interface: {
      displayName: "Repo Guard", shortDescription: "Repository policies and directory access guards.",
      longDescription: m.description, developerName: m.author.name, category: "Developer Tools",
      capabilities: ["Read"], defaultPrompt: ["Check repository access policy."],
    } }),
  });
  json(path.join(pluginRoot, "hooks/hooks.json"), buildHookConfig(host, m));
  if (host === "codex") json(path.join(out, ".agents/plugins/marketplace.json"), {
    name: `${m.name}-local-codex`, interface: { displayName: `${m.name} Local` },
    plugins: [{ name: m.name, source: { source: "local", path: `./plugins/${m.name}` }, policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" }, category: "Developer Tools" }],
  });
  else json(path.join(out, ".claude-plugin/marketplace.json"), {
    name: `${m.name}-local-claude`, owner: { name: m.author.name },
    plugins: [{ name: m.name, source: `./plugins/${m.name}`, description: m.description, version: m.version }],
  });
  return pluginRoot;
}
function inventory(root) {
  const result = {};
  function visit(dir, prefix = "") {
    for (const name of fs.readdirSync(dir).sort()) {
      if (name === "node_modules" || name === "build-info.json") continue;
      const relative = prefix ? `${prefix}/${name}` : name;
      const file = safe(root, relative), stat = fs.lstatSync(file);
      if (stat.isDirectory()) visit(file, relative);
      else if (stat.isFile()) result[relative] = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
      else throw new Error("Unexpected build file");
    }
  }
  visit(root);
  return result;
}
function verify(out, host, m) {
  const root = host === "opencode" ? path.join(out, "package") : path.join(out, "plugins", m.name);
  const built = loadManifest(root);
  if (built.name !== m.name || built.version !== m.version) throw new Error("Manifest mismatch");
  for (const file of RUNTIME) if (!fs.statSync(safe(root, file)).isFile()) throw new Error("Missing runtime");
  if (host !== "opencode") {
    const native = JSON.parse(fs.readFileSync(path.join(root, `.${host}-plugin/plugin.json`)));
    if (native.name !== m.name || native.version !== m.version || native.skills) throw new Error("Invalid native manifest");
    if (host === "codex") {
      if (native.hooks !== undefined || !native.interface || !["displayName", "shortDescription", "longDescription", "developerName", "category"]
        .every(key => typeof native.interface[key] === "string" && native.interface[key].trim())
        || JSON.stringify(native.interface.capabilities) !== '["Read"]') throw new Error("Invalid Codex interface");
    }
    if (JSON.stringify(JSON.parse(fs.readFileSync(path.join(root, "hooks/hooks.json")))) !== JSON.stringify(buildHookConfig(host, m))) throw new Error("Invalid hooks");
  }
  return root;
}
export function validateBuiltHost(root, host) {
  if (!HOSTS.includes(host)) throw new Error("Unknown host");
  const m = loadManifest(root), out = safe(root, `dist/${host}`);
  const pluginRoot = verify(out, host, m);
  const info = JSON.parse(fs.readFileSync(path.join(out, "build-info.json")));
  if (info.sourceDigest !== sourceDigest(root) || info.host !== host || JSON.stringify(info.files) !== JSON.stringify(inventory(out))) throw new Error("Stale or modified build");
  return pluginRoot;
}
export function isBuildCurrent(root, host) {
  try { validateBuiltHost(root, host); return true; } catch { return false; }
}
export function buildHosts({ root = SOURCE_ROOT, hosts = HOSTS } = {}) {
  const manifest = loadManifest(root), results = {};
  for (const host of hosts) {
    if (!HOSTS.includes(host)) throw new Error("Unknown host");
    const target = safe(root, `dist/${host}`);
    // A registered file: package may be live. Only native sync stages dependencies
    // and publishes a ready replacement; plain build must not strip them.
    if (host === "opencode" && fs.existsSync(path.join(target, "package/node_modules"))) {
      if (isBuildCurrent(root, host)) { results[host] = path.join(target, "package"); continue; }
      throw new Error("OpenCode package has prepared dependencies; use native install --apply to update safely");
    }
    fs.mkdirSync(safe(root, "dist"), { recursive: true });
    const stage = fs.mkdtempSync(path.join(root, "dist", `.build-${host}-`));
    const backup = `${target}.backup-${randomUUID()}`;
    let swapped = false;
    try {
      generate(root, host, manifest, stage);
      verify(stage, host, manifest);
      json(path.join(stage, "build-info.json"), { host, name: manifest.name, version: manifest.version, sourceDigest: sourceDigest(root), files: inventory(stage) });
      if (fs.existsSync(target)) { fs.renameSync(target, backup); swapped = true; }
      try { fs.renameSync(stage, target); } catch (error) { if (swapped) fs.renameSync(backup, target); throw error; }
      if (swapped) fs.rmSync(backup, { recursive: true, force: true });
      results[host] = host === "opencode" ? path.join(target, "package") : path.join(target, "plugins", manifest.name);
    } finally { fs.rmSync(stage, { recursive: true, force: true }); }
  }
  return { manifest, results };
}
