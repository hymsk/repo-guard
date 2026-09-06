# repo-guard

> A cross-host security plugin for Codex, Claude Code, and OpenCode.

[简体中文](README.zh-cn.md) · [Repository](https://github.com/hymsk/repo-guard) · [Specification](SPEC.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Release guide](RELEASE.md)

`repo-guard` is a security plugin that applies repository access policy before supported tool execution. It identifies Git repositories using an exclusive whitelist or blacklist and rejects access beneath directories carrying a configurable ancestor marker. It preflights mapped Read/Bash calls in Codex, Claude Code, and OpenCode; OpenCode additionally supports batch preflight and a session-scoped enable/disable control.

The project is built on the [Agent Plugin Base](https://github.com/hymsk/agent-plugin-base) source template. It retains the base's host-neutral manifest, shared-handler structure, event normalization, and host adapters while independently implementing repository policies, directory preflight, and native installation management. This is a source-template relationship, not a runtime dependency: installing or running `repo-guard` does not require an Agent Plugin Base checkout. See [BASE-LINEAGE.md](BASE-LINEAGE.md) for the recorded baseline and intentional differences.

> [!IMPORTANT]
> `repo-guard` is a defense-in-depth preflight control, not an OS sandbox, a complete shell parser, or a data-loss prevention system. Use operating-system permissions, Host permissions, and isolated environments to constrain actual access, and verify behavior with the Host versions used in your deployment.

## Use cases

- **Allow only approved repositories**: Use whitelist mode to permit mapped Read/Bash calls only when the selected Git remote matches an entry in the active CSV.
- **Block known-sensitive repositories**: Use blacklist mode to reject matching repositories while allowing other valid remote identities.
- **Protect directory trees before Git checks**: Place `.ai-forbidden`, or a configured marker, in any ancestor directory to reject supported access beneath it, including non-Git paths.

## Installation

### Requirements

- Node.js 22+, npm, Git and a POSIX shell (Linux/macOS/WSL). Native Windows is not supported by the hook wrapper.
- The appropriate host CLI for installation. OpenCode SDK is pinned to `@opencode-ai/plugin@1.18.31`; its installation requires registry access.

Install from source:

```bash
git clone https://github.com/hymsk/repo-guard.git
cd repo-guard
npm run build
npm run validate
node scripts/agent-plugin.mjs install --host all             # review the plan
node scripts/agent-plugin.mjs install --host opencode --apply
# Select codex or claude instead when appropriate.
```

No registry package is currently distributed. `install` prints a plan by default and invokes Host CLIs only when `--apply` is explicit. Installation uses native Host registration rather than manual hook/config merging. Review the targets before applying, keep the checkout and `dist` paths in place, and restart the Host afterwards. Codex users must also review and trust the hook in `/hooks`; registration alone does not prove activation, and Host policy may disable hooks.

`dist/codex` and `dist/claude` contain local marketplaces and plugins; `dist/opencode/package` contains the OpenCode module. OpenCode updates stage dependencies and restore the previous package on handled failures; publication uses two renames, not a zero-gap atomic exchange. Codex/Claude updates can uninstall/reinstall the exact verified plugin and are not atomic. Never remove an uncertain installation lock without investigating it.

## Configure

OpenCode supports native `[plugin, options]` entries in `opencode.json`. Replace the existing entry rather than adding a duplicate:

```json
{
  "plugin": [
    ["file:///absolute/path/to/repo-guard/dist/opencode/package", {
      "policyMode": "whitelist",
      "whitelistCsv": "/absolute/path/to/whitelist.csv",
      "forbiddenMarker": ".ai-forbidden",
      "remote": "origin"
    }]
  ]
}
```

Codex/Claude hooks read `~/.repo-guard/config.json`, whose contents are the options object above, without the `plugin` wrapper. OpenCode also reads this file: defaults < user plugin JSON < native options. User JSON and the active CSV are reloaded per call; native options require a host restart. Repository-local configuration is never loaded by repo-guard itself. Host-level project configuration remains under the host's trust model.

| Option | Default / rule |
| --- | --- |
| `policyMode` | `whitelist` or `blacklist`; defaults to `whitelist` |
| `whitelistCsv` | Absolute path required in whitelist mode; unused and may be omitted in blacklist mode |
| `blacklistCsv` | Absolute path required in blacklist mode; unused and may be omitted in whitelist mode |
| `forbiddenMarker` | `.ai-forbidden`; one basename using ASCII letters, digits, dot, underscore or hyphen, excluding `.`/`..`, at most 255 characters |
| `remote` | `origin`; remote name, not a URL |

Unknown keys, invalid types/paths, malformed or unreadable user JSON deny protected calls. Omit unused options instead of providing empty strings. A missing user JSON file uses defaults/native options. The old policy environment variables are no longer read. Advanced logging and session-state environment controls remain separate from policy configuration.

### Exclusive lists

Whitelist mode allows a matching repository and rejects others. Blacklist mode rejects a matching repository and allows other valid remote identities:

```json
{
  "policyMode": "blacklist",
  "blacklistCsv": "/absolute/path/to/blacklist.csv"
}
```

Only the active list is read, even when both paths are configured. Both formats use an exact, unique `repo` CSV header, in any position; `name`, `details` and other columns never authorize access. See [whitelist](examples/whitelist.csv), [blacklist](examples/blacklist.csv) and [configuration](examples/config.json) examples. Keep real policies outside the checkout.

Identities match the full lowercased host, effective port and case-sensitive full repository path across HTTPS, SSH URL and SCP syntax. Trailing `/` and one `.git` suffix are removed; HTTPS 443 and SSH 22 are their respective default ports. Other ports remain significant. No host/path prefix, suffix or path-only grants. HTTP, query/fragment, encoded paths, dot segments and ambiguous addresses are rejected. Malformed CSV invalidates the active policy. Invalid whitelist cells do not grant access; invalid blacklist cells invalidate the policy rather than silently dropping a denial. A header-only blacklist is the explicit empty-blacklist form.

### Directory markers

Place `.ai-forbidden` (or the configured basename) in a directory to reject supported accesses beneath it. The contents are never read; existence alone counts, even a directory or dangling marker symlink. Checks cover lexical and resolved paths and all ancestors up to the filesystem root, not only the Git root. Metadata errors and unresolved target symlinks deny access. Paths containing `..` are conservatively rejected to avoid symlink normalization ambiguity.

All recognized Read/Bash targets are checked before Git subprocesses. OpenCode batch preflights all protected subcalls before repository checks. Markers apply to non-Git directories too. Without a marker, non-Git paths and repositories without the selected remote retain their permissive behavior. Failure to establish a Git root is currently treated as non-Git; this is not a fail-closed Git-availability guarantee.

## Rejection and limitations

- Codex/Claude emit standard `PreToolUse` deny results; bridge startup failures become exit 2. OpenCode throws in `tool.execute.before`. These are execution vetoes, not advisory prompts.
- Protection covers mapped Read/Bash tools and OpenCode batch, not all MCP, edit, managed or interactive tools. Bash syntax that this lightweight preflight cannot safely parse (such as redirection, pipelines, shell substitution, globbing, backslash escapes and `--option=/path` values) is rejected; accepted commands still do not provide complete shell parsing, recursive descendant access, hard-link protection or TOCTOU guarantees.
- Another plugin may run concurrently. This plugin cannot guarantee that another audit plugin does not inspect or upload content.
- OpenCode's `repo_guard_mode` tool accepts `status`, `on`, `off`. Turning it off requests `repo_guard_disable` permission and disables the entire guard for that session, including marker checks. Configure that host permission as `ask` if every disable must require confirmation.
- Debug logs are off by default. `REPO_GUARD_LOG_LEVEL=debug` can record paths, raw remote URLs and command fragments, including embedded secrets. Never publish real logs or policies.

Read [SECURITY.md](SECURITY.md) and [SPEC.md](SPEC.md) before relying on the plugin.

## Uninstall

```bash
node scripts/agent-plugin.mjs uninstall --host codex          # plan
node scripts/agent-plugin.mjs uninstall --host codex --apply
node scripts/agent-plugin.mjs uninstall --host claude --apply
node scripts/agent-plugin.mjs uninstall --host opencode
```

OpenCode uninstallation gives manual instructions to remove its `plugin` entry; the installer does not rewrite that configuration. Policies and logs are retained. Restart the host afterwards.

## Development and source export

```bash
npm run check
npm test
npm run build
npm run validate
npm run test:standalone
npm run test:host  # optional isolated native OpenCode probe; downloads SDK
```

Default tests are synthetic/offline and need no model, Python or adjacent manager. Optional CodeAgent integration: `node tests/codeagent-install.test.mjs --manager-scripts /absolute/path/to/codeagent/scripts` (Python 3 required). A supplied but invalid integration path fails; skipping integration is not proof of manager compatibility.

`npm run test:standalone` exports the fixed public source inventory to a temporary directory and runs the offline checks/tests/build there under an isolated HOME. To prepare a separately reviewable source tree:

```bash
node scripts/export-source.mjs /absolute/path/to/new-public-source
```

The destination must not exist and must be outside the checkout. The exporter rejects symlinked inputs and copies only [public-files.json](public-files.json), excluding Git history, private policies, internal helpers, logs, dependencies and build/install caches. It does not create a repository, commit, push, tag or release. Review the exported tree before publishing; do not recursively copy a private working directory.

Offline tests verify synthetic protocol and installation behavior, not a real model conversation or native host activation. The optional `test:host` probe targets isolated OpenCode 1.18.31 installation/loading. Record exact versions, platform and results using [RELEASE.md](RELEASE.md) before making native compatibility claims. Real-model end-to-end and cross-platform acceptance remain separate checks.

## License

Copyright (C) 2026 hymsk. Licensed under [AGPL-3.0-or-later](LICENSE), without warranty. See [NOTICE](NOTICE) for source lineage and dependency boundaries. The source checkout is marked `private` to prevent accidental npm publication; that does not restrict the license's permissions.
