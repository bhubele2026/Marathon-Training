import { Router, type IRouter } from "express";
import {
  db,
  planDaysTable,
  planWeeksTable,
  workoutsTable,
  measurementsTable,
  plannerConfigsTable,
} from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";
import {
  getAnthropic,
  isConfigured,
  MODEL,
  Anthropic,
} from "@workspace/integrations-anthropic";
import {
  buildSystemBriefing,
  runGuardrails,
  materializeAiPlan,
  PROPOSE_PLAN_TOOL,
  PROPOSE_PLAN_TOOL_NAME,
  type AiPlan,
  type PersonalContext,
  type DailyBudget,
} from "@workspace/plan-knowledge";

const router: IRouter = Router();

// Default machines the runner owns (canonical order). Mirrors the engine's
// equipment vocabulary; used to brief Claude when we can't infer from data.
const DEFAULT_EQUIPMENT = [
  "Tonal",
  "Peloton Bike",
  "Peloton Row",
  "Peloton Tread",
  "Outdoor",
];

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// Gather the personalization context for the system briefing from the DB:
// latest weight + goal, budget override, recent-activity rollup, runner notes.
async function gatherContext(): Promise<PersonalContext> {
  const activeRows = await db
    .select()
    .from(plannerConfigsTable)
    .where(eq(plannerConfigsTable.isActive, true))
    .limit(1);
  const active = activeRows[0];

  const latestMeas = await db
    .select()
    .from(measurementsTable)
    .orderBy(desc(measurementsTable.date))
    .limit(1);
  const earliestMeas = await db
    .select()
    .from(measurementsTable)
    .orderBy(measurementsTable.date)
    .limit(1);

  const currentWeightLbs = latestMeas[0]?.weight ?? null;

  // Recent-activity rollup: workout count over the last 30 days + weight trend.
  const [{ count: workouts30 } = { count: 0 }] = (
    await db.execute<{ count: number }>(
      sql`SELECT COUNT(*)::int AS count FROM workouts WHERE date >= (CURRENT_DATE - INTERVAL '30 days')`,
    )
  ).rows;

  const summaryParts: string[] = [];
  if (workouts30 > 0) {
    summaryParts.push(`${workouts30} workouts logged in the last 30 days.`);
  }
  if (
    earliestMeas[0]?.weight != null &&
    latestMeas[0]?.weight != null &&
    earliestMeas[0].date !== latestMeas[0].date
  ) {
    summaryParts.push(
      `Weight ${earliestMeas[0].weight}→${latestMeas[0].weight} lb between ${earliestMeas[0].date} and ${latestMeas[0].date}.`,
    );
  }

  const budget: DailyBudget = active?.dailyBudget ?? {};

  return {
    todayISO: todayISO(),
    currentWeightLbs,
    goalWeightLbs: active?.goalWeight ?? null,
    equipment: DEFAULT_EQUIPMENT,
    budget,
    recentActivitySummary: summaryParts.length ? summaryParts.join(" ") : null,
    notes: active?.notes ?? null,
  };
}

type ChatTurn = { role: "user" | "assistant"; content: string };

// POST /api/plan-builder/chat — streamed (SSE) conversational plan authoring.
// Body: { messages: ChatTurn[], currentPlan?: AiPlan }
// Streams: {type:"text",text} deltas, then {type:"plan",...} if Claude proposed
// a plan, then {type:"done"} (or {type:"error",message}).
router.post("/plan-builder/chat", async (req, res): Promise<void> => {
  if (!isConfigured()) {
    res.status(400).json({
      error:
        "ANTHROPIC_API_KEY is not set. Add it as a Replit secret (Tools → Secrets) to use the Claude plan builder.",
    });
    return;
  }

  const body = req.body as { messages?: ChatTurn[]; currentPlan?: AiPlan };
  const turns = Array.isArray(body.messages) ? body.messages : [];
  if (turns.length === 0) {
    res.status(400).json({ error: "messages[] is required." });
    return;
  }

  const ctx = await gatherContext();
  let system = buildSystemBriefing(ctx);
  if (body.currentPlan) {
    // Give Claude the plan it's revising. Cheaper + more reliable than
    // reconstructing tool_use/tool_result history on the client.
    system += `\n\n## Current working plan (revise this per the latest message)\n${JSON.stringify(
      body.currentPlan,
    )}`;
  }

  const messages: Anthropic.MessageParam[] = turns.map((t) => ({
    role: t.role,
    content: t.content,
  }));

  // SSE setup.
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  res.flushHeaders?.();
  const send = (evt: unknown) => res.write(`data: ${JSON.stringify(evt)}\n\n`);

  // Abort the model call if the client disconnects.
  const controller = new AbortController();
  req.on("close", () => controller.abort());

  try {
    // Params cast to any: `output_config.effort` and adaptive `thinking` are
    // GA on the API but may not be in the installed SDK's static types yet.
    // The wire shape is correct; the cast just keeps the build green.
    const params = {
      model: MODEL,
      max_tokens: 64000,
      thinking: { type: "adaptive" as const },
      // Interactive use — balance reasoning quality with latency.
      output_config: { effort: "medium" as const },
      system,
      tools: [PROPOSE_PLAN_TOOL],
      messages,
    };
    const stream = getAnthropic().messages.stream(params as never, {
      signal: controller.signal,
    });

    stream.on("text", (delta: string) => send({ type: "text", text: delta }));

    const final = await stream.finalMessage();

    // Pull the proposed plan out of the tool_use block, if any.
    const toolBlock = final.content.find(
      (b): b is Anthropic.ToolUseBlock =>
        b.type === "tool_use" && b.name === PROPOSE_PLAN_TOOL_NAME,
    );
    if (toolBlock) {
      const plan = toolBlock.input as AiPlan;
      const materialized = materializeAiPlan(plan);
      const guardrails = runGuardrails(plan, ctx.budget);
      send({
        type: "plan",
        plan,
        guardrails,
        weekly: materialized.weekly,
        marathonDate: materialized.marathonDate,
        totalWeeks: materialized.totalWeeks,
      });
    }

    send({ type: "done" });
    res.end();
  } catch (err) {
    req.log?.error({ err }, "plan-builder chat failed");
    // If headers are already sent we can only emit an SSE error frame.
    send({
      type: "error",
      message: err instanceof Error ? err.message : "Plan builder failed.",
    });
    res.end();
  }
});

// POST /api/plan-builder/accept — persist a Claude-authored plan as a new active
// config (source="ai") and seed plan_weeks/plan_days from it, reusing the same
// truncate/insert/rebind/snapshot sequence as /planner/apply.
// Body: { plan: AiPlan, name?: string }
router.post("/plan-builder/accept", async (req, res): Promise<void> => {
  const body = req.body as { plan?: AiPlan; name?: string };
  const plan = body.plan;
  if (
    !plan ||
    !Array.isArray(plan.weeks) ||
    plan.weeks.length === 0 ||
    !plan.startDate
  ) {
    res.status(400).json({ error: "A plan with at least one week is required." });
    return;
  }

  const materialized = materializeAiPlan(plan);
  const name = (body.name || plan.name || "Claude Plan").slice(0, 120);

  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`LOCK TABLE plan_days, plan_weeks, reset_undo_snapshots IN ACCESS EXCLUSIVE MODE`,
    );

    const [{ count: workoutsBefore } = { count: 0 }] = (
      await tx.execute<{ count: number }>(
        sql`SELECT COUNT(*)::int AS count FROM workouts`,
      )
    ).rows;
    const [{ count: measurementsBefore } = { count: 0 }] = (
      await tx.execute<{ count: number }>(
        sql`SELECT COUNT(*)::int AS count FROM measurements`,
      )
    ).rows;
    const [{ count: snapshotsBefore } = { count: 0 }] = (
      await tx.execute<{ count: number }>(
        sql`SELECT COUNT(*)::int AS count FROM reset_undo_snapshots`,
      )
    ).rows;

    // Single-active invariant: demote any currently-active config.
    await tx
      .update(plannerConfigsTable)
      .set({ isActive: false })
      .where(eq(plannerConfigsTable.isActive, true));

    // New config id (the table uses a manually-assigned integer PK).
    const [{ maxId } = { maxId: 0 }] = (
      await tx.execute<{ maxId: number | null }>(
        sql`SELECT MAX(id) AS "maxId" FROM planner_configs`,
      )
    ).rows;
    const newId = (maxId ?? 0) + 1;
    const now = new Date();

    await tx.insert(plannerConfigsTable).values({
      id: newId,
      name,
      isActive: true,
      startDate: plan.startDate,
      marathonDate: materialized.marathonDate,
      blocks: [], // engine blocks unused for ai-source configs
      entries: null,
      source: "ai",
      aiPlan: plan,
      // Snapshot immediately — this config IS being applied right now.
      lastAppliedAt: now,
      appliedStartDate: plan.startDate,
      appliedMarathonDate: materialized.marathonDate,
      appliedBlocks: [],
      appliedEntries: null,
      appliedAiPlan: plan,
    });

    // Detach workout FKs before truncating plan_days.
    await tx
      .update(workoutsTable)
      .set({ planDayId: null })
      .where(sql`${workoutsTable.planDayId} IS NOT NULL`);

    await tx.execute(
      sql`TRUNCATE TABLE plan_days, plan_weeks, reset_undo_snapshots RESTART IDENTITY CASCADE`,
    );

    await tx.insert(planWeeksTable).values(
      materialized.weekly.map((w) => ({
        week: w.week,
        phase: w.phase,
        startDate: w.startDate,
        endDate: w.endDate,
        plannedStrength: w.plannedStrength,
        plannedCardio: w.plannedCardio,
        plannedTotalLoad: w.plannedTotalLoad,
        plannedMiles: w.plannedMiles,
        longRunMi: w.longRunMi,
      })),
    );

    const chunk = 100;
    for (let i = 0; i < materialized.days.length; i += chunk) {
      const slice = materialized.days.slice(i, i + chunk);
      await tx.insert(planDaysTable).values(
        slice.map((d) => ({
          week: d.week,
          phase: d.phase,
          date: d.date,
          day: d.day,
          sourceEntryIndex: d.sourceEntryIndex,
          sourceEntryLabel: d.sourceEntryLabel,
          strengthLoad: d.strengthLoad,
          equipment: d.equipment,
          equipmentList: d.equipmentList,
          description: d.description,
          strengthMin: d.strengthMin,
          cardioMin: d.cardioMin,
          runMin: d.runMin,
          distanceMi: d.distanceMi,
          pace: d.pace,
          sessionType: d.sessionType,
          isRest: d.isRest,
          totalLoad: d.totalLoad,
          // seed_* mirrors so the "reset to original" affordance works.
          seedSessionType: d.sessionType,
          seedEquipment: d.equipment,
          seedEquipmentList: d.equipmentList,
          seedDescription: d.description,
          seedDistanceMi: d.distanceMi,
          seedStrengthMin: d.strengthMin,
          seedCardioMin: d.cardioMin,
          seedRunMin: d.runMin,
          seedPace: d.pace,
          seedStrengthLoad: d.strengthLoad,
          seedTotalLoad: d.totalLoad,
          seedIsRest: d.isRest,
        })),
      );
    }

    // Best-effort rebind of logged workouts to the new plan_days by date.
    await tx.execute(sql`
      UPDATE workouts w
      SET plan_day_id = pd.id
      FROM plan_days pd
      WHERE pd.date = w.date AND w.plan_day_id IS NULL
    `);

    return {
      configId: newId,
      weeksSeeded: materialized.weekly.length,
      daysSeeded: materialized.days.length,
      workoutsPreserved: workoutsBefore,
      measurementsPreserved: measurementsBefore,
      undoSnapshotsWiped: snapshotsBefore,
      totalWeeks: materialized.totalWeeks,
    };
  });

  req.log?.warn(
    { configId: result.configId, weeksSeeded: result.weeksSeeded, daysSeeded: result.daysSeeded },
    "claude-authored plan accepted — plan_weeks/plan_days seeded",
  );
  res.json(result);
});

export default router;
