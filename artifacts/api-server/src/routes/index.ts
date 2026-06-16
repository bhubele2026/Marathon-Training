import { Router, type IRouter } from "express";
import healthRouter from "./health";
import planRouter from "./plan";
import workoutsRouter from "./workouts";
import measurementsRouter from "./measurements";
import dashboardRouter from "./dashboard";
import raceWeekRouter from "./race-week";
import plannerRouter from "./planner";
import planBuilderRouter from "./plan-builder";
import preferencesRouter from "./preferences";
import scheduledRacesRouter from "./scheduled-races";
import nutritionRouter from "./nutrition";

const router: IRouter = Router();

router.use(healthRouter);
router.use(planRouter);
router.use(workoutsRouter);
router.use(measurementsRouter);
router.use(dashboardRouter);
router.use(raceWeekRouter);
router.use(plannerRouter);
router.use(planBuilderRouter);
router.use(preferencesRouter);
router.use(scheduledRacesRouter);
router.use(nutritionRouter);

export default router;
