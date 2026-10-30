#!/usr/bin/env node
// Build step: tsc emits only JavaScript, so copy the demo's cassettes and assets
// next to the compiled demo module (dist/server/demo), where the server looks for them.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
for (const name of ["cassettes", "assets"]) {
  const from = path.join(root, "src/server/demo", name);
  if (fs.existsSync(from)) fs.cpSync(from, path.join(root, "dist/server/demo", name), { recursive: true });
}
