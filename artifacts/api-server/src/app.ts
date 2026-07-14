import fs from "node:fs";
import path from "node:path";
import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
// 25mb body cap (default is 100kb): Health Auto Export workout payloads carry
// per-second heart-rate / route arrays per workout and were 413-ing the import.
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

app.use("/api", router);

// Single-service deploy (Render): this one Express process serves both the JSON
// API (mounted above at /api) AND the built React SPA. On Replit these were two
// separate artifacts glued by Replit's router; here they share one origin, which
// is why the frontend's relative "/api" fetches keep working with zero rewiring.
//
// The block is a no-op when the client build is absent (CLIENT_DIR unset and the
// default path missing) so API-only local dev / tests are unaffected. esbuild
// bundles this file to a single dist/index.mjs with __dirname rewritten, so the
// SPA dir is resolved from the repo root (process.cwd()) or an explicit
// CLIENT_DIR env, never a relative import path.
const clientDir =
  process.env.CLIENT_DIR ??
  path.resolve(process.cwd(), "artifacts/command-center/dist/public");

if (fs.existsSync(path.join(clientDir, "index.html"))) {
  logger.info({ clientDir }, "Serving SPA from client build");
  app.use(express.static(clientDir));
  // SPA client-side-routing fallback: any non-/api GET returns index.html so
  // deep links (e.g. /nutrition) load the app instead of 404-ing. /api is
  // already handled above, and the negative-lookahead keeps it that way.
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(clientDir, "index.html"));
  });
} else {
  logger.info(
    { clientDir },
    "No client build found; serving API only (set CLIENT_DIR to serve the SPA)",
  );
}

export default app;
