# Contributing

Read [SPEC.md](SPEC.md) and [SECURITY.md](SECURITY.md). Keep changes focused and update both READMEs for user-visible behavior. Contributors must have the right to license their contributions under AGPL-3.0-or-later. Do not include private policies, credentials, real logs or organization-specific examples.

## Validation

Node.js 22+, npm, Git and a POSIX shell are required. Run from the source root:

```bash
npm run check
npm test
npm run build
npm run validate
npm run test:standalone
git diff --check
```

`npm run test:host` is an optional isolated OpenCode native probe and needs npm network access. Default tests do not make model requests. Optional CodeAgent integration needs Python 3 and an explicitly supplied external source path; see the README. Test native changes without touching a daily host configuration. Report skipped, unavailable and failed checks honestly.

## Commits and reviews

Use Conventional Commits: `type(scope): summary`, adding `!` and a migration explanation for breaking changes. Initial imports, public baselines, releases, compatibility changes and complex fixes require a substantive body explaining purpose, main changes, impact and actual validation; a file list or version alone is insufficient. Review the complete diff and stage exact paths. AI assistance does not replace human review and must not fabricate evidence or author/reviewer identities. Do not perform Git writes or external publication without explicit authorization. Stop on merge/push failure rather than rewriting history automatically.

## Source distribution

`public-files.json` is the explicit source distribution inventory. Add new source/docs/tests deliberately and run the standalone export test. Do not publish a recursive working-directory copy or private enclosing Git history. The exporter only creates a new local directory and never overwrites one. Inspect source output, package metadata and dependency license boundaries before release.

## Release gate

Use [RELEASE.md](RELEASE.md) for the manual, no-CI release checklist and release-notes guidance. Checkboxes are not validation evidence.

1. Review source provenance, license/NOTICE, synthetic examples, supported hosts and security limitations.
2. Run offline validation on the exported source; run relevant native probes and disclose untested platforms/real-model flows.
3. Keep repository links, package versions and manifest versions consistent; do not invent repository URLs, badges or CI results. A source version does not certify production readiness or native compatibility.
4. Keep corresponding complete source and build scripts available alongside generated host packages. Preserve LICENSE/NOTICE; separately installed dependencies retain their own licenses. Do not redistribute an installed `node_modules` tree without reviewing its notices.
5. Prepare substantive release notes: capabilities, installation/configuration, compatibility/migration, known limits and actual tests. Commit body, annotated tag and hosted release notes are separate deliverables.
6. Obtain explicit authorization for remote creation, push, tag and release. Commit/push permission is not release permission; do not move public tags or rewrite public history without separate approval.

The source package remains `private: true` to prevent accidental npm publication. Publishing to npm requires a separate packaging and authorization decision, not just removing this flag.
