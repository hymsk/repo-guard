import path from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeHostInput, normalizePluginResult } from "./protocol.mjs";
export async function dispatchPlugin({ root, manifest, host, eventName, raw, context = {} }) {
  const module = await import(pathToFileURL(path.resolve(root, manifest.entry)).href);
  const handler = module.default || module.handle;
  if (typeof handler !== "function") throw new Error("Invalid plugin handler");
  return normalizePluginResult(await handler(normalizeHostInput(host, eventName, raw), { ...context, root, host, manifest }));
}
