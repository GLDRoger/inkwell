import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve, type ServerType } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { createDiaryRoutes } from "./routes/diary.ts";
import { createRunRoutes } from "./routes/runs.ts";
import { createEventsApp } from "./events.ts";
import { createMediaRoutes } from "./media/index.ts";
import { createMapRoutes } from "./routes/map.ts";
import { createPageRoutes } from "./routes/pages.ts";
import { createUploadRoutes } from "./routes/uploads.ts";
import { createServices, type Services } from "./services.ts";
import { installShutdown } from "./shutdown.ts";
import { createSessionMiddleware, type AppEnv } from "./session.ts";

export function createApp(
  services: Services,
  options: { heartbeatMs?: number } = {},
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/api/health", (c) => c.json({ ok: true }));

  // Every API request gets (or resumes) an anonymous workspace session.
  app.use(
    "/api/*",
    createSessionMiddleware({ db: services.db, pages: services.pages }),
  );

  app.route("/", createDiaryRoutes(services));
  app.route("/", createRunRoutes(services));
  app.route("/", createMediaRoutes(services));
  app.route("/", createPageRoutes(services));
  app.route("/", createMapRoutes(services));
  app.route("/", createUploadRoutes(services));
  app.route("/", createEventsApp(services.bus, { ...options, pages: services.pages }));

  app.notFound((c) => {
    if (c.req.path.startsWith("/api/")) return c.json({ error: "not found" }, 404);
    return c.text("not found", 404);
  });

  app.onError((err, c) => {
    console.error("[inkwell] request failed", err);
    return c.json({ error: "internal error" }, 500);
  });

  // Production: serve the built client with SPA fallback.
  if (process.env.NODE_ENV === "production") {
    const clientDir = path.resolve("./dist/client");
    if (fs.existsSync(path.join(clientDir, "index.html"))) {
      const indexHtml = serveStatic({ path: "./dist/client/index.html" });
      app.use("/*", serveStatic({ root: "./dist/client" }));
      // SPA fallback for client routes; unknown /api paths still 404 as JSON.
      app.get("*", (c, next) =>
        c.req.path.startsWith("/api/") ? next() : indexHtml(c, next),
      );
    }
  }

  return app;
}

export function startServer(
  services: Services,
  app: Hono<AppEnv>,
  port = Number(process.env.PORT ?? 8787),
): Promise<{ server: ServerType; port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port }, (info) => {
      const close = async () => {
        await services.runtime.close();
        await new Promise<void>((done) => server.close(() => done()));
      };
      resolve({ server, port: info.port, close });
    });
    server.on("upgrade", (req, socket, head) => {
      if (!services.collab.handleUpgrade(req, socket, head)) socket.destroy();
    });
  });
}

const isMain = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fileURLToPath(import.meta.url) === path.resolve(entry);
  } catch {
    return false;
  }
})();

if (isMain) {
  const services = createServices();
  const app = createApp(services);
  const { port, server } = await startServer(services, app);
  installShutdown({
    services,
    closeHttp: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  });
  console.log(`Inkwell server on :${port} (data: ${services.dataDir})`);
}
