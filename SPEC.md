# repo-guard behavior specification

## Scope and enforcement

One canonical `tool.before` handler serves Codex, Claude Code and OpenCode. Only mapped Read/Bash calls are protected; OpenCode batch supports up to 100 direct subcalls and rejects malformed/nested batches. Unknown tools pass unchanged. Codex/Claude translate denial to `PreToolUse.permissionDecision=deny`; wrapper failures map to exit 2. OpenCode throws before tool execution. Activation depends on host loading, hook trust and host policy.

## Configuration

Policy fields are `policyMode`, `whitelistCsv`, `blacklistCsv`, `forbiddenMarker`, `remote`. Defaults are whitelist, no CSV path, `.ai-forbidden`, `origin`. Configuration is merged from defaults, `~/.repo-guard/config.json`, then OpenCode native options. User JSON is reread per call; native options are per plugin instance. JSON must be an object with known string fields and valid values. Invalid/unreadable JSON denies protected calls; an absent file uses defaults. CSV paths must be absolute. Repository-local files are not configuration sources for the plugin itself; host-level configuration trust remains the host's responsibility. Retired policy environment variables have no effect.

## Directory preflight

Before any Git subprocess, validate all recognized paths of a protected call. Read checks its target, Bash checks cwd/effective cwd, recognized operands and every explicit parsed `cd` target. Batch performs an initial preflight of all protected subcalls. Check lexical and realpath ancestors through filesystem root, including directories above a Git root and existing ancestors of missing descendants. A marker exists even if it is a directory or dangling symlink; never read its content. Metadata failures and unresolved target symlinks deny. Marker names are single portable ASCII basenames, excluding dot/dot-dot. Protected paths containing `..` are rejected before lexical normalization.

This is a preflight check, not a filesystem capability. Bash syntax that the lightweight parser cannot safely classify—such as redirection, pipelines, shell substitution, globbing, backslash escapes and `--option=/path` values—is rejected rather than executed as an accepted preflight. Accepted commands still do not provide complete shell parsing. Implicit recursive reads, hard links and TOCTOU changes are outside complete enforcement. A marker below an implicitly traversed directory is not discovered by recursively scanning its descendants.

## Repository decision

After marker preflight, discover the Git root and selected remote. Failure to obtain a root is treated as non-Git and passes; this includes some Git failures. An absent selected remote passes. A listed remote with missing/empty/invalid URL denies; remote-list failure after root detection denies.

Only the selected list is loaded per decision:

- Whitelist: valid entry match allows; all other repository identities deny.
- Blacklist: match denies; nonmatch allows only a valid identity and valid active policy.
- The inactive CSV is never read and cannot override the active decision. If its path field is supplied, configuration-level validation still applies.
- Missing/unreadable/malformed active CSV denies. Exact unique `repo` header required; extra columns never authorize. CSV supports BOM, quoted commas/newlines and doubled quotes, rejecting malformed structure.
- Invalid whitelist cells are skipped. Invalid blacklist cells invalidate the whole list. Header-only blacklist is explicitly empty.

Repository keys consist of lowercased complete host, effective port and case-sensitive complete path. HTTPS/SSH/SCP transport and userinfo do not identify a different repository. Remove trailing slashes and one `.git` suffix. HTTPS 443 and SSH 22 are defaults; all other ports remain significant. Reject HTTP, query/fragment, percent encoding, backslashes, dot segments, repeated interior slashes and ambiguous host spelling. No partial, domain-wide or path-only grants.

## Disable, privacy and installation

OpenCode `repo_guard_mode off` requests host permission before writing session state. Off bypasses the entire plugin, including markers; on restores it. Default state is enabled. Advanced global state-file overrides can remove session isolation and are documented as operator controls, not policy fields.

The runtime performs no intentional network upload. Installers may contact npm/host services. Debug logging is opt-in and may include sensitive raw remote URLs or command fragments; logs are not safe publication artifacts. Fixed build and source-export inventories exclude policies and configuration.

Native installation defaults to a read-only plan; apply is explicit. No automatic trust approval or old-installation migration. OpenCode dependency upgrades are staged with handled-failure rollback; Codex/Claude updates are non-atomic. Never treat native registration receipts as proof of runtime protection. License and NOTICE accompany generated packages; distributors also provide matching complete source/build scripts under the license.

## Acceptance

Default tests use isolated/synthetic inputs and run outside any enclosing project. Optional manager integration requires an explicit manager source path. Native host probes use temporary HOME and may download SDK; they must not use real provider credentials or send model requests. Protocol and SDK tests do not prove the final model-visible rendering of errors. Release notes distinguish automated evidence from real-model and platform acceptance.
