import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

// The deployment healthcheck pings the API root (`/api`), so it must answer 2xx
// or the autoscale revision never passes health and never promotes (it would
// 404 here otherwise). Mounted at "/api", this handles both `/api` and `/api/`.
router.get("/", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

export default router;
