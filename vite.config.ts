import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  root: "src/client",
  publicDir: "public",
  resolve: { alias: { "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)) } },
  build: { outDir: "../../dist/client", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8787",
      "/collab": { target: "ws://localhost:8787", ws: true },
    },
  },
  test: { root: ".", environment: "jsdom", include: ["src/**/*.test.{ts,tsx}"] },
} as any);
