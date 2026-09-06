import fs from "node:fs";
import path from "node:path";
import { parseTable } from "./csv-parser.mjs";
import { repositoryKey } from "./git-url.mjs";
import { logger } from "./logger.mjs";
import { loadConfig } from "./config.mjs";

// Historical module name retained for callers; both lists use the same exact keys.
function loadList(source, { required = false, strict = false } = {}) {
  const entries = new Set();
  if (source === undefined) return { valid: !required, entries };
  if (!source || !path.isAbsolute(source)) return { valid: false, entries };
  try {
    const { headers, rows } = parseTable(fs.readFileSync(source, "utf8"));
    if (headers.filter(header => header === "repo").length !== 1) throw new Error("Exactly one repo header is required");
    const index = headers.indexOf("repo");
    for (const row of rows) {
      const key = repositoryKey(row[index]);
      // An invalid deny entry must not silently weaken a blacklist policy.
      if (key === null && strict) throw new Error("Invalid blacklist entry");
      if (key !== null) entries.add(key);
    }
    return { valid: true, entries };
  } catch {
    logger.log("policy", "policy_unreadable_or_invalid");
    return { valid: false, entries: new Set() };
  }
}

function loadPolicy(config) {
  const mode = config.policyMode ?? "whitelist";
  const denied = mode === "blacklist"
    ? loadList(config.blacklistCsv, { required: true, strict: true })
    : { valid: true, entries: new Set() };
  const allowed = mode === "whitelist"
    ? loadList(config.whitelistCsv, { required: true })
    : { valid: true, entries: new Set() };
  return { mode, allowed, denied, valid: ["whitelist", "blacklist"].includes(mode) && allowed.valid && denied.valid };
}

export function isAllowed(remote, config = loadConfig()) {
  const key = repositoryKey(remote);
  if (key === null) return false;
  // Reload only the active list; the two modes never combine their decisions.
  const { mode, allowed, denied, valid } = loadPolicy(config);
  return valid && !denied.entries.has(key) && (mode === "blacklist" || allowed.entries.has(key));
}

export function getStats(config = loadConfig()) {
  const { mode, allowed, denied, valid } = loadPolicy(config);
  return { mode, valid, csvPath: (mode === "blacklist" ? config.blacklistCsv : config.whitelistCsv) || null,
    allowSetSize: allowed.entries.size, normalizedSetSize: allowed.entries.size, denySetSize: denied.entries.size };
}
export function _resetForTest() { /* No policy cache. */ }
