import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function loadEnv(file) {
  const values = {};
  if (!fs.existsSync(file)) return values;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    values[key] = value;
  }
  return values;
}

export function projectRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}
