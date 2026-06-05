import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

// PORT only matters for the dev/preview server. Static production builds
// (e.g. the Replit deploy build container) do not need it, so fall back
// to a sentinel that's only consulted when vite serves traffic.
const rawPort = process.env.PORT;
const port = rawPort ? Number(rawPort) : 5173;

if (rawPort !== undefined && (Number.isNaN(port) || port <= 0)) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// BASE_PATH is set by the dev workflow and the production serve runtime.
// At build time in the deploy container it's not set, so default to "/"
// which matches the artifact's previewPath for this app.
const basePath = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // Task #382: split vendor chunks so deploy-cache hits survive
    // small app changes and heavyweight libs (recharts) only download
    // when a page that uses them is opened. Pairs with the lazyWithReload
    // route splits in App.tsx — lazy pages already pull recharts on
    // demand, the manual chunk just keeps the long-cache filename
    // stable across unrelated app edits. React itself is intentionally
    // left in the entry chunk (a dedicated react-vendor chunk came out
    // empty because the entry already imports React eagerly).
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
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
