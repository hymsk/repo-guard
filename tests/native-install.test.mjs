import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runNative, nativePlans, HOSTS } from "../src/native-install.mjs";
import { buildHosts, isBuildCurrent } from "../src/build.mjs";
import { main as cli } from "../scripts/agent-plugin.mjs";

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Fixed public allowlist only. Never walk the checkout, real Home, or CSV files.
const PUBLIC_FILES = ["LICENSE", "NOTICE", "agent-plugin.json", "scripts/host-hook.mjs", "opencode.mjs", "src/build.mjs",
  "src/plugin.mjs", "src/core/manifest.mjs", "src/core/dispatch.mjs", "src/core/protocol.mjs",
  "src/guard.mjs", "src/config.mjs", "src/forbidden-path.mjs", "src/whitelist.mjs", "src/git-info.mjs", "src/git-url.mjs", "src/csv-parser.mjs",
  "src/command-parser.mjs", "src/logger.mjs", "src/mode.mjs", "src/opencode-tool.mjs"];
function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value));
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "repo-guard-native-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const relative of PUBLIC_FILES) write(path.join(root, relative), fs.readFileSync(path.join(source, relative)));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "agent-plugin.json")));
  const states = Object.fromEntries(HOSTS.map(host => [host, { plugins: [], markets: [] }]));
  const calls = [];
  const market = host => `${manifest.name}-local-${host}`;
  const selector = host => `${manifest.name}@${market(host)}`;
  const marketRoot = host => path.join(root, "dist", host);
  const pluginRoot = host => path.join(marketRoot(host), host === "opencode" ? "package" : `plugins/${manifest.name}`);
  const addMarket = host => {
    states[host].markets = [host === "codex"
      ? { name: market(host), root: marketRoot(host), marketplaceSource: { sourceType: "local", source: marketRoot(host) } }
      : { name: market(host), source: "directory", path: marketRoot(host) }];
  };
  const addPlugin = (host, version = manifest.version) => {
    if (host === "opencode") states[host].plugins = [`file:${pluginRoot(host)}`];
    else {
      addMarket(host);
      states[host].plugins = [host === "codex"
        ? { pluginId: selector(host), name: manifest.name, marketplaceName: market(host), version,
          installed: true, enabled: true, source: { source: "local", path: pluginRoot(host) } }
        : { id: selector(host), version, scope: "user", enabled: true }];
    }
  };
  const fix = { root, states, calls, manifest, addPlugin, addMarket, market, selector, pluginRoot, marketRoot };
  const runner = (host, args, options) => {
    calls.push({ host, args, cwd: options.cwd });
    assert.equal(options.env.HOME, path.join(root, "isolated-home"));
    assert.equal(options.stdio[0], "ignore");
    if (fix.override) {
      const output = fix.override(host, args, options);
      if (output !== undefined) return output;
    }
    if (args.includes("--help")) return host === "opencode"
      ? { status: 0, stdout: "", stderr: "opencode plugin <module>\n --global" }
      : { status: 0, stdout: "Usage: native CLI\n --scope --keep-data" };
    if (host === "npm") {
      assert(options.cwd.startsWith(path.join(root, "dist") + path.sep));
      assert.equal(path.basename(options.cwd), "package");
      assert.deepEqual(args, ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false"]);
      write(path.join(options.cwd, "node_modules/@opencode-ai/plugin/package.json"), { name: "@opencode-ai/plugin", version: "1.18.31" });
      return { status: 0, stdout: "untrusted install text" };
    }
    if (args[0] === "debug") {
      assert.deepEqual(args, ["debug", "config", "--pure"]);
      return { status: 0, stdout: JSON.stringify({ plugin: states.opencode.plugins, provider: { private: "SYNTHETIC-SECRET" } }) };
    }
    if (args[1] === "marketplace") {
      if (args[2] === "list") return { status: 0, stdout: JSON.stringify(host === "codex" ? { marketplaces: states[host].markets } : states[host].markets) };
      if (args[2] === "add") addMarket(host);
      else assert.deepEqual(args, ["plugin", "marketplace", "update", market("claude")]);
    } else if (args[1] === "list") return { status: 0, stdout: JSON.stringify(host === "codex" ? { installed: states[host].plugins, available: [] } : states[host].plugins) };
    else if (["remove", "uninstall"].includes(args[1])) {
      assert.equal(args[2], selector(host));
      if (host === "claude") assert(args.includes("--keep-data"));
      states[host].plugins = [];
    } else {
      assert.equal(args[0], "plugin");
      if (host !== "opencode") assert.equal(args[2], selector(host));
      addPlugin(host, fix.installVersion || JSON.parse(fs.readFileSync(path.join(root, "agent-plugin.json"))).version);
    }
    return { status: 0, stdout: "ignored native stdout", stderr: "ignored private diagnostics" };
  };
  fix.options = { root, runner, env: { HOME: path.join(root, "isolated-home"), PATH: "mock-only" } };
  fix.run = (action, hosts = HOSTS, extra = {}) => runNative(action, hosts, { ...fix.options, ...extra });
  return fix;
}
function mutations(calls) { return calls.filter(c => c.host === "npm" || (!c.args.includes("--help") && !c.args.includes("list") && c.args[0] !== "debug")); }
function receiptPath(f, host, env = f.options.env) {
  const keys = ["HOME", "USERPROFILE", "XDG_CONFIG_HOME", ...{
    codex: ["CODEX_HOME"], claude: ["CLAUDE_CONFIG_DIR"], opencode: ["OPENCODE_CONFIG_DIR", "OPENCODE_CONFIG"],
  }[host]];
  const digest = createHash("sha256").update(JSON.stringify(keys.map(key => [key, env[key] || ""]))).digest("hex");
  return path.join(f.root, `dist/.native-install/${digest}/${host}.json`);
}
function snapshot(root) {
  const items = [];
  const visit = dir => {
    for (const name of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, name), st = fs.lstatSync(file);
      items.push([path.relative(root, file), st.mtimeMs, st.isFile() ? fs.readFileSync(file).toString("base64") : null]);
      if (st.isDirectory()) visit(file);
    }
  };
  visit(root); return items;
}

test("plan and default install/uninstall are read-only without builds, CLI probes or npm", t => {
  const f = fixture(t), before = snapshot(f.root);
  for (const action of ["plan", "install", "uninstall"]) {
    const output = f.run(action);
    assert(output.results.every(r => r.status === "planned" && r.changed === false));
    assert.equal(output.apply, false);
  }
  assert.deepEqual(f.calls, []);
  assert.deepEqual(snapshot(f.root), before);
  assert.equal(fs.existsSync(path.join(f.root, "dist")), false);
});

test("OpenCode plan encodes file URL metacharacters without a shell", t => {
  const f = fixture(t), special = path.join(f.root, "space # and % and 'quote");
  const [plan] = nativePlans(special, f.manifest, ["opencode"]);
  assert.equal(fileURLToPath(plan.commands[1][2]), path.join(special, "dist/opencode/package"));
  assert.equal(plan.commandCwds[0], path.join(special, "dist/opencode/package"));
});

test("native sync builds/validates, prepares actual OpenCode package, rechecks and is idempotent", t => {
  const f = fixture(t), first = f.run("sync");
  assert.deepEqual(first.results.map(r => r.status), ["changed", "changed", "changed"], JSON.stringify(first));
  assert(first.results.every(r => r.details.trust === "unverified"));
  assert(!JSON.stringify(first).includes("SYNTHETIC-SECRET"));
  const npm = f.calls.findIndex(c => c.host === "npm");
  const install = f.calls.findIndex(c => c.host === "opencode" && c.args[0] === "plugin" && !c.args.includes("--help"));
  assert(npm >= 0 && npm < install);
  for (const host of HOSTS) {
    assert.equal(isBuildCurrent(f.root, host), true);
    const receipt = JSON.parse(fs.readFileSync(receiptPath(f, host)));
    assert.match(receipt.buildDigest, /^[a-f0-9]{64}$/);
  }
  f.calls.length = 0;
  const before = snapshot(f.root);
  assert(f.run("status").results.every(r => r.status === "current"));
  assert.deepEqual(snapshot(f.root), before);
  assert(f.run("sync").results.every(r => r.status === "current"));
  assert.equal(mutations(f.calls).length, 0);
});

test("same-version source changes refresh native caches and OpenCode dependencies", t => {
  const f = fixture(t);
  assert.equal(f.run("sync").ok, true);
  fs.appendFileSync(path.join(f.root, "src/guard.mjs"), "\n// synthetic upgrade\n");
  assert(f.run("status").results.every(r => r.status === "planned"));
  // Even an independently refreshed build must not hide a stale native installation.
  buildHosts({ root: f.root, hosts: ["codex", "claude"] });
  assert.throws(() => buildHosts({ root: f.root, hosts: ["opencode"] }), /update safely/);
  assert(f.run("status").results.every(r => r.status === "planned"));
  f.calls.length = 0;
  const updated = f.run("sync");
  assert.equal(updated.ok, true, JSON.stringify(updated));
  for (const host of ["codex", "claude"]) {
    const calls = mutations(f.calls).filter(c => c.host === host);
    assert(calls.some(c => ["remove", "uninstall"].includes(c.args[1])));
    assert(calls.some(c => ["add", "install"].includes(c.args[1])));
  }
  assert(!f.calls.some(c => c.host === "codex" && ["update", "upgrade"].some(a => c.args.includes(a))));
  assert.equal(mutations(f.calls).filter(c => c.host === "opencode").length, 0);
  assert.equal(mutations(f.calls).filter(c => c.host === "npm").length, 1);
});

test("a shared checkout cannot reuse receipts for a different native config target", t => {
  const f = fixture(t);
  assert.equal(f.run("sync", ["codex"]).ok, true);
  const output = f.run("status", ["codex"], { env: { ...f.options.env, CODEX_HOME: path.join(f.root, "second-home") } });
  assert.equal(output.results[0].status, "planned");
  const stored = fs.readFileSync(receiptPath(f, "codex"), "utf8");
  assert(!stored.includes(f.options.env.HOME));
  assert.match(JSON.parse(stored).targetDigest, /^[a-f0-9]{64}$/);
});

test("receipts for two targets remain current when switching back and forth", t => {
  const f = fixture(t);
  const second = { ...f.options.env, CODEX_HOME: path.join(f.root, "second-home") };
  assert.equal(f.run("sync", ["codex"]).ok, true);
  const firstReceipt = fs.readFileSync(receiptPath(f, "codex"), "utf8");
  assert.equal(f.run("sync", ["codex"], { env: second }).ok, true);
  assert.equal(fs.readFileSync(receiptPath(f, "codex"), "utf8"), firstReceipt);
  assert(fs.existsSync(receiptPath(f, "codex", second)));
  f.calls.length = 0;
  for (const env of [f.options.env, second, f.options.env, second]) {
    assert.equal(f.run("status", ["codex"], { env }).results[0].status, "current");
    assert.equal(f.run("sync", ["codex"], { env }).results[0].status, "current");
  }
  assert.equal(mutations(f.calls).length, 0);
  assert.equal(f.run("uninstall", ["codex"], { env: second, apply: true }).ok, true);
  assert.equal(fs.existsSync(receiptPath(f, "codex", second)), false);
  assert.equal(fs.readFileSync(receiptPath(f, "codex"), "utf8"), firstReceipt);
});

test("old native versions are reinstalled and version is checked afterwards", t => {
  const f = fixture(t);
  for (const host of ["codex", "claude"]) f.addPlugin(host, "0.9.0");
  const updated = f.run("sync", ["codex", "claude"]);
  assert.equal(updated.ok, true, JSON.stringify(updated));
  f.states.codex.plugins[0].version = "0.9.0";
  f.installVersion = "0.9.0";
  const failure = f.run("sync", ["codex"]).results[0];
  assert.equal(failure.status, "failed");
  assert.equal(failure.details.code, "postcheck");
  assert.equal(failure.details.writesAttempted, true);
  assert.equal(fs.existsSync(receiptPath(f, "codex")), false);
});

test("build and validate use no native commands, validate never writes", t => {
  const f = fixture(t);
  assert.equal(cli(["build", "--host", "all"], f.options).ok, true);
  const before = snapshot(f.root);
  assert.equal(cli(["validate", "--host", "all"], f.options).ok, true);
  assert.deepEqual(snapshot(f.root), before);
  assert.deepEqual(f.calls, []);
});

for (const host of ["codex", "claude"]) {
  for (const fault of ["foreign-id", "foreign-source", "disabled", "unknown-enabled", "unknown-version", "load-error", "duplicate", "unknown-marketplace"]) {
    test(`${host}: ${fault} is rejected without native writes`, t => {
      const f = fixture(t); f.addPlugin(host);
      const entry = f.states[host].plugins[0];
      if (fault === "foreign-id") entry[host === "codex" ? "pluginId" : "id"] = "repo-guard@foreign";
      if (fault === "foreign-source") {
        if (host === "codex") entry.source.path = "/foreign/plugin";
        else f.states[host].markets[0].path = "/foreign/marketplace";
      }
      if (fault === "disabled") entry.enabled = false;
      if (fault === "unknown-enabled") delete entry.enabled;
      if (fault === "unknown-version") entry.version = "unknown";
      if (fault === "load-error") entry.errors = ["SYNTHETIC-SECRET"];
      if (fault === "duplicate") f.states[host].plugins.push({ ...entry });
      if (fault === "unknown-marketplace") f.states[host].markets = [];
      assert.equal(f.run("status", [host]).results[0].status, "failed");
      const outcome = f.run("sync", [host]);
      assert.equal(outcome.results[0].status, "failed");
      assert(!JSON.stringify(outcome).includes("SYNTHETIC-SECRET"));
      assert.equal(mutations(f.calls).length, 0);
    });
  }
}

test("marketplace collision without an installed plugin is rejected", t => {
  const f = fixture(t); f.addMarket("codex");
  f.states.codex.markets[0].marketplaceSource.source = "/other/source";
  assert.equal(f.run("sync", ["codex"]).results[0].details.code, "conflict");
  assert.equal(mutations(f.calls).length, 0);
});

test("Claude non-user scope is not overwritten", t => {
  const f = fixture(t); f.addPlugin("claude"); f.states.claude.plugins[0].scope = "project";
  assert.equal(f.run("sync", ["claude"]).results[0].details.code, "conflict");
});

test("OpenCode exact file URLs are supported; disabled, duplicates and other sources rejected", t => {
  const f = fixture(t);
  assert.equal(f.run("sync", ["opencode"]).ok, true);
  f.states.opencode.plugins = [pathToFileURL(f.pluginRoot("opencode")).href];
  assert.equal(f.run("status", ["opencode"]).results[0].status, "current");
  for (const plugin of [["repo-guard@0.1.0"], ["file:/foreign/repo-guard/opencode.mjs"],
    [f.pluginRoot("opencode"), f.pluginRoot("opencode")], [[f.pluginRoot("opencode"), { enabled: false }]]]) {
    f.states.opencode.plugins = plugin;
    assert.equal(f.run("status", ["opencode"]).results[0].status, "failed");
  }
});

test("OpenCode missing dependency requires sync; npm failure does not register plugin", t => {
  const f = fixture(t);
  f.override = host => host === "npm" ? { status: 1, stderr: "SYNTHETIC-SECRET", stdout: "private" } : undefined;
  const output = f.run("sync", ["opencode"]);
  assert.equal(output.results[0].status, "failed");
  assert.equal(output.results[0].details.phase, "dependencies");
  assert(!JSON.stringify(output).includes("SYNTHETIC-SECRET"));
  assert.equal(f.states.opencode.plugins.length, 0);
  f.override = undefined;
  assert.equal(f.run("sync", ["opencode"]).ok, true);
  fs.rmSync(path.join(f.pluginRoot("opencode"), "node_modules"), { recursive: true });
  assert.equal(f.run("status", ["opencode"]).results[0].status, "planned");
  assert.equal(f.run("sync", ["opencode"]).ok, true);
});

for (const fault of ["build", "npm", "sdk-version", "validate", "payload-change", "publish", "postcheck", "receipt"]) {
  test(`OpenCode failed upgrade (${fault}) leaves old package, receipt and runtime intact`, t => {
    const f = fixture(t);
    assert.equal(f.run("sync", ["opencode"]).ok, true);
    const pkg = f.pluginRoot("opencode");
    // A synthetic entry probes dependency resolution in the published package,
    // without reading any policy/configuration file or executing a real Host.
    write(path.join(pkg, "node_modules/@opencode-ai/plugin/index.js"), "exports.probe = 'old-sdk';\n");
    const probeFile = path.join(pkg, "node_modules/runtime-probe.cjs");
    write(probeFile, "process.stdout.write(require('@opencode-ai/plugin').probe);\n");
    assert.equal(isBuildCurrent(f.root, "opencode"), true);
    const treeDigest = () => createHash("sha256").update(JSON.stringify(snapshot(f.marketRoot("opencode")))).digest("hex");
    const oldTree = treeDigest();
    const oldReceipt = fs.readFileSync(receiptPath(f, "opencode"), "utf8");
    const assertIntact = () => {
      assert.equal(treeDigest(), oldTree, "published tree changed before commit or was not restored");
      assert.equal(fs.readFileSync(receiptPath(f, "opencode"), "utf8"), oldReceipt);
      const probe = spawnSync(process.execPath, [probeFile], { env: f.options.env, encoding: "utf8" });
      assert.equal(probe.status, 0, probe.stderr);
      assert.equal(probe.stdout, "old-sdk");
    };
    fs.appendFileSync(path.join(f.root, "src/guard.mjs"), "\n// failed upgrade\n");
    if (["publish", "receipt"].includes(fault)) {
      const rename = fs.renameSync;
      t.mock.method(fs, "renameSync", (from, to) => {
        if ((fault === "publish" && to === f.marketRoot("opencode") && from.endsWith("dist/opencode"))
          || (fault === "receipt" && to === receiptPath(f, "opencode"))) throw new Error("SYNTHETIC-SECRET");
        return rename(from, to);
      });
    }
    let npmCalled = false;
    f.override = (host, args, options) => {
      if (host === "npm") {
        npmCalled = true;
        assertIntact(); // During dependency preparation, not just after rollback.
        assert.notEqual(options.cwd, pkg);
        if (fault === "npm") return { status: 1, stderr: "SYNTHETIC-SECRET" };
        if (fault === "sdk-version") {
          write(path.join(options.cwd, "node_modules/@opencode-ai/plugin/package.json"), { name: "@opencode-ai/plugin", version: "0.0.0" });
          return { status: 0 };
        }
        if (fault === "payload-change") fs.appendFileSync(path.join(options.cwd, "src/guard.mjs"), "\n// unexpected npm mutation\n");
      }
      if (fault === "postcheck" && npmCalled && host === "opencode" && args[0] === "debug") return { status: 0, stdout: "{}" };
    };
    const extra = fault === "build" ? { buildHosts: () => { assertIntact(); throw new Error("SYNTHETIC-SECRET"); } }
      : fault === "validate" ? { validateBuiltHost: () => { assertIntact(); throw new Error("SYNTHETIC-SECRET"); } } : {};
    const output = f.run("sync", ["opencode"], extra);
    assert.equal(output.results[0].status, "failed");
    assert.equal(output.results[0].details.phase, { npm: "dependencies", "sdk-version": "dependencies", "payload-change": "dependencies" }[fault] || fault);
    assert(!JSON.stringify(output).includes("SYNTHETIC-SECRET"));
    assertIntact();
    assert.equal(f.states.opencode.plugins.length, 1);
    assert.equal(fs.readdirSync(path.join(f.root, "dist")).some(name => name.startsWith(".native-opencode-")), false);
    t.mock.restoreAll();
    f.override = undefined;
    assert.equal(f.run("sync", ["opencode"]).ok, true);
    assert.equal(f.run("status", ["opencode"]).results[0].status, "current");
  });
}

test("postcheck unknown state is failed and successful hosts retain their result", t => {
  const f = fixture(t); let installed = false;
  f.override = (host, args) => {
    if (host !== "claude") return;
    if (args[1] === "install" && !args.includes("--help")) installed = true;
    if (installed && args[1] === "list") return { status: 0, stdout: '{"secret":"SYNTHETIC-SECRET"}' };
  };
  const output = f.run("sync");
  assert.deepEqual(output.results.map(r => r.status), ["changed", "failed", "changed"]);
  assert.equal(output.results[1].details.phase, "postcheck");
  assert(output.results[1].details.completedSteps.includes("native-install"));
  assert(!JSON.stringify(output).includes("SYNTHETIC-SECRET"));
});

test("unknown JSON, thrown errors and missing CLI are sanitized per host", t => {
  const f = fixture(t);
  for (const answer of [() => { throw new Error("SYNTHETIC-SECRET"); }, () => ({ status: null, error: new Error("SYNTHETIC-SECRET") }),
    () => ({ status: 0, stdout: "bad JSON SYNTHETIC-SECRET" }), () => ({ status: 0, stdout: '{"plugin":"invalid"}' })]) {
    f.override = answer;
    const output = f.run("status");
    assert.equal(output.results.length, 3);
    assert(output.results.every(r => r.status === "failed"));
    assert(!JSON.stringify(output).includes("SYNTHETIC-SECRET"));
  }
});

test("unrecognized CLI capability fails before removing the existing plugin", t => {
  const f = fixture(t); f.addPlugin("claude", "0.9.0");
  f.override = (host, args) => args.includes("--help") ? { status: 0, stdout: "Usage: claude plugin uninstall --scope" } : undefined;
  assert.equal(f.run("sync", ["claude"]).results[0].details.code, "capability");
  assert.equal(mutations(f.calls).length, 0);
});

test("OpenCode uninstall is manual and does not read/write native configuration", t => {
  const f = fixture(t), before = snapshot(f.root);
  const output = f.run("uninstall", ["opencode"], { apply: true });
  assert.equal(output.results[0].status, "unsupported");
  assert.match(output.results[0].details.manual, /手动/);
  assert.deepEqual(snapshot(f.root), before);
  assert.deepEqual(f.calls, []);
});

test("native uninstall uses exact selectors and verifies absence, keeps marketplaces", t => {
  const f = fixture(t); assert.equal(f.run("sync", ["codex", "claude"]).ok, true);
  f.states.claude.plugins[0].enabled = false;
  assert.equal(f.run("uninstall", ["codex", "claude"], { apply: true }).ok, true);
  assert(f.states.codex.markets.length && f.states.claude.markets.length);
  assert.equal(f.states.codex.plugins.length, 0);
  assert.equal(f.states.claude.plugins.length, 0);
  assert.equal(f.run("uninstall", ["codex"], { apply: true }).results[0].status, "current");
});

test("failed remove or build does not proceed to native install and retains all host results", t => {
  const f = fixture(t); f.addPlugin("codex", "0.9.0");
  f.override = (host, args) => host === "codex" && args[1] === "remove" && !args.includes("--help")
    ? { status: 0, stdout: "pretend success but leave installed state unchanged" } : undefined;
  const refused = f.run("sync", ["codex"]);
  assert.equal(refused.results[0].status, "failed");
  assert.equal(refused.results[0].details.phase, "remove-postcheck");
  assert(!mutations(f.calls).some(c => c.args[1] === "add"));
  f.calls.length = 0;
  const output = f.run("sync", HOSTS, { buildHosts: () => { throw new Error("SYNTHETIC-SECRET"); }, isBuildCurrent: () => false });
  assert.equal(output.results.length, 3);
  assert(output.results.every(r => r.status === "failed"));
  assert.equal(mutations(f.calls).length, 0);
  assert(!JSON.stringify(output).includes("SYNTHETIC-SECRET"));
});

test("same-version reinstall failure invalidates the old receipt for retry", t => {
  const f = fixture(t); assert.equal(f.run("sync", ["codex"]).ok, true);
  fs.appendFileSync(path.join(f.root, "src/guard.mjs"), "\n// another change\n");
  f.override = (host, args) => args[1] === "add" && !args.includes("--help") ? { status: 1, stderr: "SYNTHETIC-SECRET" } : undefined;
  const output = f.run("sync", ["codex"]);
  assert.equal(output.results[0].status, "failed");
  assert(output.results[0].details.completedSteps.includes("native-remove-for-refresh"));
  assert.equal(fs.existsSync(receiptPath(f, "codex")), false);
  assert.equal(f.run("status", ["codex"]).results[0].status, "planned");
  f.override = undefined;
  assert.equal(f.run("sync", ["codex"]).ok, true);
});

test("symlinked receipt directory and concurrent lock fail closed", t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.root, "dist"));
  fs.mkdirSync(path.join(f.root, "outside"));
  fs.symlinkSync(path.join(f.root, "outside"), path.join(f.root, "dist/.native-install"));
  assert.equal(f.run("sync", ["codex"]).results[0].status, "failed");
  assert.deepEqual(fs.readdirSync(path.join(f.root, "outside")), []);
  fs.unlinkSync(path.join(f.root, "dist/.native-install"));
  write(path.join(f.root, "dist/.native-install/codex.lock"), "");
  assert.equal(f.run("sync", ["codex"]).results[0].details.code, "busy");
  assert.equal(f.calls.length, 0);
});

test("CLI rejects unknown or duplicate options and supports the base interface", t => {
  const f = fixture(t);
  assert.equal(cli([], f.options).ok, true);
  for (const args of [["status"], ["install", "--host"], ["install", "--host", "unknown"],
    ["install", "--host", "codex", "--host", "claude"], ["install", "--apply", "--apply"], ["validate", "--apply"]]) {
    assert.throws(() => cli(args, f.options));
  }
  assert.equal(cli(["install", "--host", "codex"], f.options).apply, false);
  assert.deepEqual(f.calls, []);
});
