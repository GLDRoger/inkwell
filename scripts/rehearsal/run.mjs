#!/usr/bin/env node
// npm run rehearse: the fake Meta API, the Inkwell server pointed at it, and the Vite client.
// Ports (env): REHEARSAL_META_PORT=8799, REHEARSAL_APP_PORT=8788, REHEARSAL_CLIENT_PORT=5174.
// Data: REHEARSAL_DATA_DIR (default ./data/rehearsal), kept apart from ./data.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startFakeMeta } from "./fake-meta.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
process.chdir(root);
const metaPort = Number(process.env.REHEARSAL_META_PORT ?? 8799);
const appPort = Number(process.env.REHEARSAL_APP_PORT ?? 8788);
const clientPort = Number(process.env.REHEARSAL_CLIENT_PORT ?? 5174);
const dataDir = path.resolve(process.env.REHEARSAL_DATA_DIR ?? "data/rehearsal");

const fake = await startFakeMeta({ port: metaPort, fast: process.env.REHEARSAL_FAST === "1" });

// No --env-file: the rehearsal must never pick up a real key or base URL from .env.
const server = spawn(process.execPath, ["--import", "tsx", "src/server/main.ts"], {
  stdio: "inherit",
  env: { ...process.env, PORT: String(appPort), DATA_DIR: dataDir, META_BASE_URL: fake.url, META_API_KEY: "rehearsal" },
});

for (let i = 0; ; i++) {
  try { if ((await fetch(`http://127.0.0.1:${appPort}/api/health`)).ok) break; } catch { /* still booting */ }
  if (server.exitCode !== null || i > 120) { console.error("[rehearse] server failed to start"); await fake.close(); process.exit(1); }
  await new Promise((resolve) => setTimeout(resolve, 250));
}

const { createServer } = await import("vite");
const vite = await createServer({
  configFile: path.join(root, "vite.config.ts"),
  server: {
    port: clientPort, strictPort: true,
    proxy: {
      "/api": `http://127.0.0.1:${appPort}`,
      "/collab": { target: `ws://127.0.0.1:${appPort}`, ws: true },
    },
  },
});
await vite.listen();
console.log(`\n[rehearse] Inkwell with the rehearsal Meta API
  client  http://localhost:${clientPort}
  server  http://127.0.0.1:${appPort} (data: ${dataDir})
  meta    ${fake.url}\n`);

let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  await vite.close().catch(() => {});
  if (server.exitCode === null) {
    server.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => server.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 8000))]);
    if (server.exitCode === null) server.kill("SIGKILL");
  }
  await fake.close();
  process.exit(code);
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
server.on("exit", (code) => { if (!stopping) { console.error(`[rehearse] server exited (${code})`); stop(1); } });
