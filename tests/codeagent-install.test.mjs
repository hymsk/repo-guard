import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runInstaller, main } from "../scripts/codeagent-install.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "repo-guard-manager-"));
const hosts = ["codex", "claude", "opencode"];
const records = [];
const publicFiles = ["LICENSE", "NOTICE", "agent-plugin.json", "codeagent.json", "install.sh", "scripts/codeagent-install.mjs", "scripts/agent-plugin.mjs",
  "src/native-install.mjs", "src/build.mjs", "scripts/host-hook.mjs", "opencode.mjs", "src/plugin.mjs",
  "src/core/manifest.mjs", "src/core/dispatch.mjs", "src/core/protocol.mjs", "src/guard.mjs", "src/config.mjs", "src/forbidden-path.mjs", "src/whitelist.mjs",
  "src/git-info.mjs", "src/git-url.mjs", "src/csv-parser.mjs", "src/command-parser.mjs", "src/logger.mjs", "src/mode.mjs", "src/opencode-tool.mjs"];
function write(file, content) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); }
function snapshot(directory) {
  const out = [];
  function visit(dir) {
    for (const name of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, name), stat = fs.lstatSync(file);
      out.push([path.relative(directory, file), stat.mtimeMs, stat.isFile() ? fs.readFileSync(file).toString("base64") : null]);
      if (stat.isDirectory()) visit(file);
    }
  }
  visit(directory); return out;
}
function fixture(name) {
  const directory = path.join(tmp, name), sourceDir = path.join(directory, "source"), home = path.join(directory, "home");
  for (const relative of publicFiles) write(path.join(sourceDir, relative), fs.readFileSync(path.join(root, relative)));
  fs.mkdirSync(home);
  const bin = path.join(directory, "bin"); fs.mkdirSync(bin);
  fs.symlinkSync(process.execPath, path.join(bin, "node"));
  const mock = `#!${process.execPath}
import fs from 'node:fs'; import path from 'node:path';
const host=path.basename(process.argv[1]), a=process.argv.slice(2), root=process.cwd();
const stateFile=path.join(process.env.HOME,'mock-native.json');
const state=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile)):{};
const s=state[host]||={plugins:[],markets:[]};
const m=JSON.parse(fs.readFileSync(path.join(root,'agent-plugin.json')));
const market=m.name+'-local-'+host, mr=path.join(root,'dist',host), selector=m.name+'@'+market;
const pr=path.join(mr,host==='opencode'?'package':'plugins/'+m.name);
const emit=x=>process.stdout.write(JSON.stringify(x));
if(a.includes('--help')) { console.log('Usage: native CLI; opencode plugin <module> --scope --global --keep-data'); }
else if(a[0]==='debug') { emit({plugin:s.plugins,private:'SYNTHETIC-SECRET'}); }
else if(a[1]==='marketplace'&&a[2]==='list') { emit(host==='codex'?{marketplaces:s.markets}:s.markets); }
else if(a[1]==='list') { emit(host==='codex'?{installed:s.plugins}:s.plugins); }
else if(host==='npm') {
 const target=path.join(root,'node_modules/@opencode-ai/plugin/package.json');
 fs.mkdirSync(path.dirname(target),{recursive:true}); fs.writeFileSync(target,JSON.stringify({name:'@opencode-ai/plugin',version:'1.18.31'}));
} else {
 if(a[1]==='marketplace'&&a[2]==='add') s.markets=[host==='codex'?{name:market,root:mr,marketplaceSource:{sourceType:'local',source:mr}}:{name:market,source:'directory',path:mr}];
 else if(a[1]==='marketplace'&&a[2]==='update') {}
 else if(a[1]==='remove'||a[1]==='uninstall') s.plugins=[];
 else s.plugins=host==='codex'?[{pluginId:selector,name:m.name,marketplaceName:market,version:m.version,installed:true,enabled:true,source:{source:'local',path:pr}}]:host==='claude'?[{id:selector,version:m.version,scope:'user',enabled:true}]:['file:'+pr];
 fs.writeFileSync(stateFile,JSON.stringify(state));
}
`;
  // npm runs with cwd equal to dist/opencode/package, whose own manifest is public.
  for (const host of [...hosts, "npm"]) { write(path.join(bin, host), mock); fs.chmodSync(path.join(bin, host), 0o755); }
  return { directory, sourceDir, home, env: { HOME: home, USERPROFILE: home, PATH: bin,
    CODEX_HOME: path.join(home, "codex"), CLAUDE_CONFIG_DIR: path.join(home, "claude"), OPENCODE_CONFIG_DIR: path.join(home, "opencode"),
    XDG_CONFIG_HOME: path.join(home, "xdg-config"), XDG_STATE_HOME: path.join(home, "xdg-state") } };
}
function execute(f, action, selected = hosts) {
  const child = spawnSync(process.execPath, [path.join(f.sourceDir, "scripts/codeagent-install.mjs"), action, "--hosts", selected.join(","), "--json"], {
    cwd: f.sourceDir, env: f.env, encoding: "utf8",
  });
  assert.ifError(child.error); assert.equal(child.status, 0, child.stderr); assert.equal(child.stderr, "");
  const payload = JSON.parse(child.stdout);
  assert.equal(payload.ok, true); assert.equal(payload.protocol, "codeagent-installer/v1");
  assert.deepEqual(payload.results.map(r => r.host), [...new Set(selected)]);
  assert(!child.stdout.includes("SYNTHETIC-SECRET"));
  records.push({ action, hosts: selected, payload });
  return payload.results;
}
try {
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, "codeagent.json"))), { schema_version: 1, kind: "plugin", hosts, cli_hosts: hosts });
  const f = fixture("contract");
  let before = snapshot(f.directory);
  assert(execute(f, "plan", [...hosts, "codex"]).every(r => r.status === "planned"));
  assert.deepEqual(snapshot(f.directory), before);
  assert(execute(f, "status").every(r => r.status === "planned"));
  assert.deepEqual(snapshot(f.directory), before);
  assert(execute(f, "sync").every(r => r.status === "changed"));
  before = snapshot(f.directory);
  assert(execute(f, "status").every(r => r.status === "current"));
  assert.deepEqual(snapshot(f.directory), before);
  assert(execute(f, "sync").every(r => r.status === "current"));

  // The adapter forwards inherited overrides unchanged and only injects HOME.
  // Reject escaping targets before even querying a native CLI, for every action.
  const guarded = fixture("manager-env");
  const overrides = { CODEX_HOME: ["codex"], CLAUDE_CONFIG_DIR: ["claude"],
    OPENCODE_CONFIG_DIR: ["opencode"], OPENCODE_CONFIG: ["opencode"], XDG_CONFIG_HOME: hosts };
  for (const explicitManagerHome of [false, true]) {
    for (const [key, affected] of Object.entries(overrides)) {
      for (const value of [path.join(guarded.directory, "SYNTHETIC-SECRET"), "../SYNTHETIC-SECRET"]) {
        const env = { ...guarded.env, [key]: value, ...(explicitManagerHome ? { AI_MANAGER_HOME: guarded.home } : {}) };
        for (const action of ["plan", "status", "sync"]) {
          let calls = 0;
          const output = runInstaller(action, affected, { root: guarded.sourceDir, env, runner: () => { calls++; throw new Error("must not call"); } });
          assert.equal(output.ok, true);
          assert(output.results.every(r => r.status === "failed" && r.details.code === "target"));
          assert(!JSON.stringify(output).includes(value));
          assert.equal(calls, 0);
        }
      }
    }
  }
  const mixed = execute({ ...guarded, env: { ...guarded.env, AI_MANAGER_HOME: guarded.home, CODEX_HOME: path.join(guarded.directory, "SYNTHETIC-SECRET") } }, "sync");
  assert.deepEqual(mixed.map(r => r.status), ["failed", "changed", "changed"]);
  const managerAuthority = fixture("manager-authority");
  managerAuthority.env = { ...managerAuthority.env, AI_MANAGER_HOME: managerAuthority.home, HOME: path.join(managerAuthority.directory, "unused-home"), USERPROFILE: path.join(managerAuthority.directory, "unused-profile") };
  assert(execute(managerAuthority, "sync").every(r => r.status === "changed"));
  assert.equal(fs.existsSync(managerAuthority.env.HOME), false);
  assert.equal(fs.existsSync(managerAuthority.env.USERPROFILE), false);

  const scopes = fixture("two-scopes"), secondHome = path.join(scopes.directory, "second-home");
  fs.mkdirSync(secondHome);
  const scopeEnv = home => ({ HOME: home, USERPROFILE: home, AI_MANAGER_HOME: home, PATH: scopes.env.PATH });
  assert(execute({ ...scopes, env: scopeEnv(scopes.home) }, "sync").every(r => r.status === "changed"));
  assert(execute({ ...scopes, env: scopeEnv(secondHome) }, "sync").every(r => r.status === "changed"));
  for (const home of [scopes.home, secondHome, scopes.home, secondHome]) {
    assert(execute({ ...scopes, env: scopeEnv(home) }, "status").every(r => r.status === "current"));
    assert(execute({ ...scopes, env: scopeEnv(home) }, "sync").every(r => r.status === "current"));
  }

  fs.appendFileSync(path.join(f.sourceDir, "src/guard.mjs"), "\n// synthetic upgrade\n");
  assert(execute(f, "status").every(r => r.status === "planned"));
  assert(execute(f, "sync").every(r => r.status === "changed"));
  const stateFile = path.join(f.home, "mock-native.json"), state = JSON.parse(fs.readFileSync(stateFile));
  state.claude.plugins[0].enabled = false; fs.writeFileSync(stateFile, JSON.stringify(state));
  assert.deepEqual(execute(f, "sync").map(r => r.status), ["current", "failed", "current"]);

  // Without binaries, plan still works, status returns three sanitized failures.
  const unavailable = fixture("unavailable"); unavailable.env.PATH = path.join(unavailable.directory, "missing");
  before = snapshot(unavailable.directory);
  assert(execute(unavailable, "plan").every(r => r.status === "planned"));
  assert(execute(unavailable, "status").every(r => r.status === "failed"));
  assert.deepEqual(snapshot(unavailable.directory), before);
  const imported = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(pathToFileURL(path.join(unavailable.sourceDir, "scripts/codeagent-install.mjs")).href)})`], { env: unavailable.env, encoding: "utf8" });
  assert.equal(imported.status, 0, imported.stderr); assert.equal(imported.stdout, "");
  assert.deepEqual(snapshot(unavailable.directory), before);

  for (const args of [[], ["uninstall", "--hosts", "codex"], ["plan"], ["plan", "--hosts", ""],
    ["sync", "--hosts", "codex,unknown"], ["plan", "--hosts", "codex", "--source", "/unexpected"],
    ["plan", "--hosts", "codex", "--hosts", "claude"], ["plan", "--hosts", "codex", "--json", "--json"]]) {
    assert.throws(() => main(args, { sourceDir: unavailable.sourceDir }));
    const child = spawnSync(process.execPath, [path.join(unavailable.sourceDir, "scripts/codeagent-install.mjs"), ...args], { env: unavailable.env, encoding: "utf8" });
    assert.equal(child.status, 1); assert.equal(JSON.parse(child.stdout).ok, false);
  }
  assert.throws(() => runInstaller("unknown", hosts));

  // install.sh has no setup fallback and defaults to a no-CLI/no-build dry-run.
  const shell = spawnSync("/bin/bash", [path.join(unavailable.sourceDir, "install.sh"), "--all"], {
    env: { ...unavailable.env, PATH: "/usr/bin:/bin", REPO_GUARD_NODE: process.execPath }, encoding: "utf8",
  });
  assert.equal(shell.status, 0, shell.stderr); assert.equal(JSON.parse(shell.stdout).apply, false);
  assert.deepEqual(snapshot(unavailable.directory), before);

  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--manager-scripts" || !path.isAbsolute(args[1]))) throw new Error("Usage: --manager-scripts /absolute/path/to/codeagent/scripts");
  if (args.length) {
  const managerScripts = args[1];
  assert(fs.statSync(path.join(managerScripts, "ai_component_manager/manager.py")).isFile(), "Manager source is required");
  const fresh = fixture("manager");
  const python = spawnSync("python3", ["-B", "-c", `
import json, pathlib, shutil, sys
sys.path.insert(0, sys.argv[1])
from ai_component_manager.registry import load_registry
from ai_component_manager.adapters.delegated import _validate_payload
from ai_component_manager.manager import ComponentManager
data = json.load(sys.stdin)
root = pathlib.Path(sys.argv[2])
registries = {"skill": "skills/list.txt", "mcp": "mcps/list.txt", "plugin": "plugins/list.txt", "rules": "rules/list.txt"}
for kind, relative in registries.items():
    target = root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("repo-guard\\n" if kind == "plugin" else "")
source = root / "plugins/repo-guard"
shutil.copytree(data["sourceDir"], source)
config = root / "components.json"
config.write_text(json.dumps({"developer": "hymsk", "schema_version": 2, "registries": registries}))
registry = load_registry(config)
component, = registry.components
assert component.installer_driver == "node"
assert list(component.cli_hosts) == data["hosts"]
for record in data["records"]:
    assert _validate_payload(record["payload"], record["hosts"], record["action"]) == "", record
manager = ComponentManager(registry, pathlib.Path(data["home"]), root / "state", env=data["env"])
for action, status in [("plan", "planned"), ("status", "planned"), ("sync", "changed"), ("status", "current"), ("sync", "current")]:
    results = manager.execute(action, {"plugin"}, tuple(data["hosts"]), None, False)
    assert [item.status for item in results] == [status] * 3, results
    assert [item.host for item in results] == data["hosts"]
for key, affected in [("CODEX_HOME", {"codex"}), ("CLAUDE_CONFIG_DIR", {"claude"}), ("OPENCODE_CONFIG_DIR", {"opencode"}), ("OPENCODE_CONFIG", {"opencode"}), ("XDG_CONFIG_HOME", set(data["hosts"]))]:
    for explicit_home in [False, True]:
        env = dict(data["env"], **{key: str(root / "SYNTHETIC-SECRET"), "HOME": str(root / "unused-home")})
        if explicit_home:
            env["AI_MANAGER_HOME"] = data["home"]
        guarded = ComponentManager(registry, pathlib.Path(data["home"]), root / "state", env=env)
        results = guarded.execute("status", {"plugin"}, tuple(data["hosts"]), None, False)
        assert [item.status for item in results] == ["failed" if host in affected else "current" for host in data["hosts"]], results
        assert "SYNTHETIC-SECRET" not in str(results)
        results = guarded.execute("sync", {"plugin"}, tuple(data["hosts"]), None, False)
        assert {item.host for item in results} == affected and all(item.status == "failed" for item in results), results
        assert "SYNTHETIC-SECRET" not in str(results)
print("manager descriptor, delegated validator (%d envelopes), mock-native adapter lifecycle passed" % len(data["records"]))
`, managerScripts, path.join(tmp, "manager-registry")], {
    input: JSON.stringify({ records, hosts, ...fresh }), encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: path.join(tmp, "python-home"), PYTHONDONTWRITEBYTECODE: "1" },
  });
  assert.ifError(python.error); assert.equal(python.status, 0, python.stderr); process.stdout.write(python.stdout);
  } else console.log("SKIP: external CodeAgent Python integration (supply --manager-scripts to run)");
  console.log("CodeAgent native delegation: isolated CLI/import/dry-run/upgrade/partial-failure checks passed");
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
