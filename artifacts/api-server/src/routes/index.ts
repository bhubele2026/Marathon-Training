import { Router, type IRouter } from "express";
import healthRouter from "./health";
import planRouter from "./plan";
import workoutsRouter from "./workouts";
import measurementsRouter from "./measurements";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(planRouter);
router.use(workoutsRouter);
router.use(measurementsRouter);
router.use(dashboardRouter);

export default router;
