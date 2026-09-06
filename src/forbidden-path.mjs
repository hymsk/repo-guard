import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.mjs";

/** Metadata only; never read marker contents, directory listings, or Git here. */
export function checkForbiddenPaths(paths, config = loadConfig()) {
  const marker = config.forbiddenMarker ?? ".ai-forbidden";
  // A single portable basename, not a relative path, glob, or list of markers.
  if (!/^[A-Za-z0-9._-]+$/.test(marker) || [".", ".."].includes(marker) || marker.length > 255) {
    return { allowed: false, reason: "invalid-marker-config" };
  }
  const checked = new Set();
  const inspect = start => {
    for (let current = start; ; current = path.dirname(current)) {
      if (!checked.has(current)) {
        checked.add(current);
        try {
          // lstat also detects a dangling marker symlink: existence alone denies.
          fs.lstatSync(path.join(current, marker));
          return false;
        } catch (error) {
          if (!["ENOENT", "ENOTDIR"].includes(error.code)) throw error;
        }
      }
      if (path.dirname(current) === current) return true;
    }
  };
  try {
    for (const target of paths) {
      if (typeof target !== "string" || !path.isAbsolute(target) || target.includes("\0") || target.split(/[\\/]/).includes("..")) throw new Error("Invalid target");
      const absolute = path.resolve(target);
      // Includes the target itself when it is a directory, and all lexical parents.
      if (!inspect(absolute)) return { allowed: false, reason: "forbidden-marker" };
      for (let current = absolute; ; current = path.dirname(current)) {
        let resolved;
        try { resolved = fs.realpathSync(current); }
        catch (error) {
          if (!["ENOENT", "ENOTDIR"].includes(error.code)) throw error;
          // Missing descendants are fine; an unresolved symlink is not verifiable.
          try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error("Unresolved symlink"); }
          catch (statError) { if (!["ENOENT", "ENOTDIR"].includes(statError.code)) throw statError; }
        }
        if (resolved && !inspect(resolved)) return { allowed: false, reason: "forbidden-marker" };
        if (path.dirname(current) === current) break;
      }
    }
    return { allowed: true };
  } catch { return { allowed: false, reason: "path-unverifiable" }; }
}
