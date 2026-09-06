import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const within = (parent, child) => child === parent || child.startsWith(`${parent}${path.sep}`);

export function exportSource(destination, source = root) {
  if (typeof destination !== "string" || !path.isAbsolute(destination)) throw new Error("Absolute destination required");
  source = fs.realpathSync(source);
  const target = path.join(fs.realpathSync(path.dirname(destination)), path.basename(destination));
  if (within(source, target) || within(target, source)) throw new Error("Destination must be outside the source tree");
  const inventoryPath = path.join(source, "public-files.json");
  if (!fs.lstatSync(inventoryPath).isFile() || fs.lstatSync(inventoryPath).isSymbolicLink()) throw new Error("Invalid public inventory");
  const files = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));
  if (!Array.isArray(files) || !files.length || new Set(files).size !== files.length) throw new Error("Invalid public inventory");
  for (const name of files) {
    if (typeof name !== "string" || !name || path.isAbsolute(name) || name.includes("\\") || name.includes("\0")
      || name.split("/").some(part => !part || [".", "..", ".git", "dist", "node_modules"].includes(part))) throw new Error("Invalid public path");
    let current = source;
    for (const part of name.split("/")) {
      current = path.join(current, part);
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error("Symlinked public input rejected");
    }
    if (!fs.statSync(current).isFile()) throw new Error("Public input must be a regular file");
  }
  // No overwrite or history import. Failure cleans up only the newly owned output.
  fs.mkdirSync(target);
  try {
    for (const name of files) {
      const output = path.join(target, name);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.copyFileSync(path.join(source, name), output, fs.constants.COPYFILE_EXCL);
    }
  } catch (error) { fs.rmSync(target, { recursive: true, force: true }); throw error; }
  return { files: files.length, destination: target };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error("Usage: node scripts/export-source.mjs /absolute/new-directory");
    console.log(JSON.stringify(exportSource(process.argv[2])));
  } catch { console.error("Source export failed; check destination and public inventory. No publication performed."); process.exitCode = 1; }
}
