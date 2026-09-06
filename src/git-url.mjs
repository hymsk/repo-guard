/** HTTPS / SSH / SCP -> exact authority + repository path, never a path-only key. */
export function repositoryKey(input) {
  if (typeof input !== "string" || /[\x00-\x1f\x7f]/.test(input)) return null;
  const text = input.trim();
  // Reject URL rewriting ambiguities rather than silently decode or normalize paths.
  if (!text || /[\s\\%?#]/u.test(text)) return null;
  let scheme, authority, pathname;
  const urlMatch = text.match(/^(https|ssh):\/\/([^/]+)\/(.+)$/i);
  if (urlMatch) [, scheme, authority, pathname] = urlMatch;
  else {
    const scp = text.match(/^([^@/:]+)@(\[[^\]]+\]|[^/:]+):([^/].*)$/);
    if (!scp) return null;
    scheme = "ssh"; authority = `${scp[1]}@${scp[2]}`; pathname = scp[3];
  }
  scheme = scheme.toLowerCase();
  const hostPort = authority.slice(authority.lastIndexOf("@") + 1);
  const match = hostPort.match(/^(\[[^\]]+\]|[^:\[\]]+)(?::([0-9]+))?$/);
  if (!match || authority.split("@").length > 2) return null;
  const [, rawHost, rawPort] = match;
  if (scheme === "ssh" && authority.includes("@")) {
    const username = authority.slice(0, authority.indexOf("@"));
    if (!/^[A-Za-z0-9._-]+$/.test(username)) return null;
  }
  let host;
  try {
    host = new URL(`https://${rawHost}`).hostname.toLowerCase();
    if (!rawHost.startsWith("[")) {
      // Do not equate trailing-dot domains, encoded/IDN spelling, or shorthand IPv4.
      if (host !== rawHost.toLowerCase() || host.length > 253
        || !host.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null;
    }
  } catch { return null; }
  let port = rawPort === undefined ? "" : String(Number(rawPort));
  if (port && (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535)) return null;
  if ((scheme === "https" && port === "443") || (scheme === "ssh" && port === "22")) port = "";
  pathname = pathname.replace(/\/+$/, "");
  if (pathname.endsWith(".git")) pathname = pathname.slice(0, -4);
  if (!pathname || pathname.startsWith("~") || pathname.split("/").some(part => !part || part === "." || part === "..")) return null;
  return `${host}${port ? `:${port}` : ""}/${pathname}`;
}

// Display/backwards-compatible API only; matching uses repositoryKey(rawRemote).
// Do not feed this synthesized HTTPS URL back into matching: SSH port 443 is nondefault.
export function normalizeGitUrl(input) {
  const key = repositoryKey(input);
  return key === null ? null : `https://${key}`;
}
export function tryNormalizeGitUrl(input) { return normalizeGitUrl(input); }
