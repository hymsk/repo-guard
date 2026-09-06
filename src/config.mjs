import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const defaults = Object.freeze({ policyMode: "whitelist", forbiddenMarker: ".ai-forbidden", remote: "origin" });
const fields = new Set([...Object.keys(defaults), "whitelistCsv", "blacklistCsv"]);
function validate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid repo-guard configuration");
  for (const [key, entry] of Object.entries(value)) {
    if (!fields.has(key) || typeof entry !== "string" || !entry || entry.includes("\0")) throw new Error("Invalid repo-guard configuration");
    if (key === "policyMode" && !["whitelist", "blacklist"].includes(entry)) throw new Error("Invalid policyMode");
    if (key.endsWith("Csv") && !path.isAbsolute(entry)) throw new Error("Absolute CSV path required");
    if (key === "forbiddenMarker" && (!/^[A-Za-z0-9._-]+$/.test(entry) || [".", ".."].includes(entry) || entry.length > 255)) throw new Error("Invalid marker name");
    if (key === "remote" && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(entry)) throw new Error("Invalid remote name");
  }
  return value;
}

/** Explicit configuration for internal callers and isolated tests. No environment fallback. */
export function normalizeConfig(value = {}) {
  return Object.freeze({ ...defaults, ...validate(value) });
}

/** User-owned plugin config only; never look in the target repository or dist. */
export function loadConfig(options = {}) {
  const filename = path.join(os.homedir(), ".repo-guard", "config.json");
  let stored = {};
  try { stored = JSON.parse(fs.readFileSync(filename, "utf8")); }
  catch (error) {
    if (error.code !== "ENOENT") throw new Error("Cannot load repo-guard configuration");
    // A dangling configuration symlink is not an absent configuration.
    try { fs.lstatSync(filename); throw new Error("Cannot load repo-guard configuration"); }
    catch (statError) { if (statError.code !== "ENOENT") throw new Error("Cannot load repo-guard configuration"); }
  }
  return normalizeConfig({ ...validate(stored), ...validate(options) });
}
