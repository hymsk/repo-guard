# Release and maintenance guide

This is a maintainer checklist for source distributions and hosted releases. No CI is required or configured by this process. Run gates locally for the exact distribution source; see [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## Release inputs

- [x] Keep the repository links in both READMEs aligned with the project source: <https://github.com/hymsk/repo-guard>.
- [x] Keep the source and manifest versions aligned at `0.1.0`; the version does not by itself establish production readiness or security certification.
- [ ] Confirm source distribution rights under AGPL-3.0-or-later and preserve LICENSE/NOTICE. Review separately installed SDK dependency licenses before redistributing an installed tree.
- [x] Keep [BASE-LINEAGE.md](BASE-LINEAGE.md)'s public Base commit mapping aligned. Preserve the distinction between the original derivation baseline and later public comparison revision; do not export private history to make the original commit resolvable.
- [ ] Retain `private: true`. Source distribution does not require npm publication; any registry name and publishing workflow require a separate decision.

## Local gates (no CI)

Run from the standalone source root:

```bash
node --version
npm --version
git --version
npm run check
npm test
npm run build
npm run validate
npm run test:standalone
git diff --check # Git checkout only
```

- [ ] Record OS/architecture, exact Node/npm/Git versions and actual results. Repeat on Node 22 before claiming the declared minimum is verified, and test the deployment runtime.
- [ ] Review the diff and allowlisted source for secrets, real policies/logs, internal addresses, machine paths, broken links, missing inputs and licensing issues. An explicit inventory is not a secret sanitizer.
- [ ] Run `npm run test:host` in its isolated environment when OpenCode acceptance is required; it may download SDK dependencies. Record exact host/SDK/platform versions. Do not touch daily configuration or use provider credentials.
- [ ] Validate Codex and Claude installation/loading, tool mapping, denial and trust in isolated configurations before claiming those native versions are tested. Offline tests and installation receipts are not proof of activation.
- [ ] Record external CodeAgent integration as skipped unless explicitly tested with `node tests/codeagent-install.test.mjs --manager-scripts /absolute/path/to/codeagent/scripts` (Python 3 required).
- [ ] Disclose untested platforms and real-model flows. No model requests without separate authorization. Node/SDK protocol tests do not establish final model-visible behavior.

## Source export and release artifacts

```bash
node scripts/export-source.mjs /absolute/path/to/new-public-source
```

The destination must not exist, must be outside the source tree, and must have an existing parent. Review the exported files and run the gates there; Git checks apply only once it is a checkout. Never recursively copy the working directory or private enclosing Git history. Re-export and revalidate if source changes.

- [ ] Retain the exact verified source snapshot and record the corresponding public commit when preparing release artifacts; history changes require separate authorization.
- [ ] If attaching host packages, build from the exact release source and supply matching complete source/build scripts, LICENSE and NOTICE. Compute checksums of final archives; review licenses before including `node_modules`.
- [ ] Finalize source/installation links, release notes, target commit, versions and prerelease status before obtaining explicit remote/push/tag/Release authorization. Commit/push does not authorize a hosted Release or npm publication.

## Release notes guidance

Release notes should identify the version, exact source commit, capabilities, installation/configuration path, compatibility and migration requirements, known limits, and the validation actually performed.

### Purpose and lineage

`repo-guard` is developed from the `agent-plugin-base` source template, with independent repository policy, directory preflight and native installation behavior. This is not a runtime dependency: the base need not be installed or checked out. See [BASE-LINEAGE.md](BASE-LINEAGE.md) for original provenance, intentional differences and the public-reference mapping.

### Capabilities and installation

One canonical `tool.before` handler serves Codex, Claude Code and OpenCode. Supported Read/Bash calls use exclusive allowlist/denylist policies and ancestor directory markers; OpenCode additionally handles direct batch subcalls and a permission-gated session switch. Source installation and configuration are described in [README.md](README.md) and [README.zh-cn.md](README.zh-cn.md). Node 22+, Git and a POSIX shell are required. OpenCode packages declare `@opencode-ai/plugin@1.18.31`; native host versions actually tested must be recorded separately.

### Compatibility and limits

Policy uses user JSON/OpenCode native options, not retired policy environment variables or repository-local configuration. `repo_path` and HTTP do not authorize repository identities. No automatic migration of old hooks/plugins is provided. Codex hook trust is separate from registration; Codex/Claude upgrades are non-atomic. This is best-effort preflight, not a sandbox or comprehensive data-loss prevention system: unknown tools pass, Git-root discovery failure can pass, and shell expansion, recursive reads, hard links and TOCTOU remain limitations. Disabling the guard also disables marker checks.

### Validation and source availability

For each release, record the exact public commit, environment, commands/results, native probes and skipped gates. Add source/artifact links and checksums when attaching archives. Do not present README historical acceptance as verification of a newer snapshot, or a local test pass as production certification.
