# Security and privacy

repo-guard is a best-effort tool preflight plugin, **not an OS sandbox, network firewall or comprehensive exfiltration prevention system**. Do not make it the only boundary protecting secrets from untrusted tools or agents.

## Threat boundary

- Requires active, trusted host hooks. Host configuration, other plugins and tools outside Read/Bash may bypass it. Disabling the plugin intentionally disables all checks.
- Unknown tools pass. Shell parsing is heuristic; scripts, expansion, recursive traversal, aliases/hard links and check/use races are not completely mediated.
- Without a directory marker, non-Git paths and missing selected remotes pass. Git-root discovery failure is treated as non-Git, not a global denial.
- User plugin JSON/native options and CSV policy files are trusted operator inputs. Protect them with filesystem permissions. Do not accept untrusted host project configuration that weakens native options.
- Another plugin may observe a call before or concurrently with this plugin. No guarantee is made that audit or capture plugins cannot see/upload content.
- Defaults do not imply that every inaccessible file is blocked. Test actual host activation and tool mapping in your deployment.

## Sensitive data

Keep real policies and user configuration outside the public source tree. Debug logging may include local paths, raw remote URLs with credentials, or command fragments; it is off by default and is not a redaction mechanism. Do not attach real logs, policies, captures or configuration to public issues. Use `.invalid` hosts and fabricated values in reproductions. Installation may access npm/host services, while runtime checks do not intentionally upload data.

## Reporting

Report a suspected vulnerability privately to the package maintainer at `lxj_hymsk@163.com`, using a minimal synthetic reproduction, affected source revision, host/Node versions and expected versus observed behavior. Do not send live credentials or private repository content. No response-time or supported-version SLA is promised. No public security advisory portal is assumed until an official remote is announced.

For an incident, rely on host/OS access controls or stop the agent; merely turning this plugin off removes protection. Review operator policy and installation state separately from code fixes.
