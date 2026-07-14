import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// PORT only matters for the dev/preview server. Static production builds (the
// Render build step just runs `vite build`) never serve traffic, so fall back
// to a sentinel that's only consulted when vite actually serves.
const rawPort = process.env.PORT;
const port = rawPort ? Number(rawPort) : 5173;

if (rawPort !== undefined && (Number.isNaN(port) || port <= 0)) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// In the single-service Render deploy Express serves the built SPA from "/",
// so the app is always mounted at the root. BASE_PATH stays overridable for
// local experiments but defaults to "/".
const basePath = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base: basePath,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    // Express serves this directory (see api-server/src/app.ts + CLIENT_DIR).
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // Split heavyweight vendors so a page that never opens a chart doesn't pay
    // for recharts, and long-cache filenames stay stable across app-only edits.
    rollupOptions: {
      output: {
        manualChunks: {
          recharts: ["recharts"],
          "query-vendor": ["@tanstack/react-query"],
          "router-vendor": ["wouter"],
          "date-vendor": ["date-fns"],
        },
      },
    },
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: { strict: true },
    // DEV-ONLY, opt-in: point /api at a live backend for local design/QA.
    proxy: process.env.DEV_API_PROXY
      ? {
          "/api": {
            target: process.env.DEV_API_PROXY,
            changeOrigin: true,
            secure: true,
          },
        }
      : undefined,
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
