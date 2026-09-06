# Agent guidelines

Read this file and [SPEC.md](SPEC.md) before modifying the standalone repo-guard source. Prefer Chinese for collaboration; retain technical identifiers as written.

- Preserve exclusive whitelist/blacklist modes and pre-Git ancestor-marker checks. Never silently weaken an invalid active policy.
- Only supported Read/Bash calls and OpenCode batch are protected; do not advertise a complete sandbox or fail-closed Git-root detection.
- Keep user configuration outside target repositories and public distributions. Use only synthetic policies, repositories and credentials in tests.
- OpenCode native options and user plugin JSON are policy configuration; do not restore policy environment overrides.
- Keep runtime/build/staging inventories aligned. New public files must be deliberately listed in `public-files.json`.
- Keep English and Chinese READMEs, SPEC, tests and behavior consistent. Do not add developer identity headers to individual files.
- Run `npm run check`, `npm test`, `npm run build`, `npm run validate`, `npm run test:standalone` and `git diff --check`. Native host tests require explicit isolated configuration; never modify daily host configuration for testing.
- Follow [CONTRIBUTING.md](CONTRIBUTING.md). Do not stage, commit, push, publish, deploy or rewrite history without explicit authorization. A commit/push instruction does not authorize a release.
- Do not remove unrelated user files, policies, logs or uncertain installation locks. License text and notices must accompany distributions.
