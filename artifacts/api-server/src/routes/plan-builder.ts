import { Router, type IRouter } from "express";
import {
  db,
  planDaysTable,
  planWeeksTable,
  workoutsTable,
  measurementsTable,
  plannerConfigsTable,
  userPreferencesTable,
  planDraftsTable,
} from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";
import { computeRecompSummary } from "./dashboard";
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
import { computePlannedLoad } from "../lib/nutrition-engine";
import { computeAndPersistBaselineBestEffort } from "./goals";

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

// Phase 4: derive the nutrition-baseline inputs from a plan. The coach attaches
// daily targets to the plan (plan.nutrition); when present they become the
// persisted baseline via a FAST safety-clamp (no AI/web call). When absent we
// fall back to the AI baseline calc, passing the plan's goal weight + week-count
// timeframe so the safe-rate math stays plan-aware. Shared by accept (apply) and
// the chat handler (propose) so the food tracks the plan in both.
function nutritionInputsFromPlan(
  plan: AiPlan,
  goalWeightLb: number | null,
): {
  planCtx: { goalWeightLb: number | null; timeframeWeeks: number; desiredWeeklyRateLb: number | null };
  override:
    | { calorieTarget: number; proteinTargetG: number; carbsTargetG: number; fatTargetG: number; rationale: string }
    | null;
} {
  const planCtx = {
    goalWeightLb: goalWeightLb,
    timeframeWeeks: plan.weeks.length,
    desiredWeeklyRateLb: plan.nutrition?.weeklyRateLb ?? null,
  };
  const override = plan.nutrition
    ? {
        calorieTarget: Math.round(plan.nutrition.calorieTarget),
        proteinTargetG: Math.round(plan.nutrition.proteinTargetG),
        carbsTargetG: Math.round(plan.nutrition.carbsTargetG),
        fatTargetG: Math.round(plan.nutrition.fatTargetG),
        rationale: plan.nutrition.rationale ?? "",
      }
    : null;
  return { planCtx, override };
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

  // Phase 3 cadence (Mon rest; Tue-Thu short; Fri-Sun long) from the active
  // config's DailyBudget. normalizeDailyBudget (run inside the briefing +
  // guardrails) backfills the canonical short/long buckets, so passing the
  // stored jsonb through as-is is enough — defaults apply when it's empty.
  const budget: DailyBudget = active?.dailyBudget ?? {};

  // Recomp signal (inches lost + muscle proxy + Tonal strength score + weight)
  // — the DEFAULT objective when no race is set. Reuses the dashboard's
  // computeRecompSummary so the builder and the dashboard read the same numbers.
  let recomp: PersonalContext["recomp"] = null;
  try {
    const rs = await computeRecompSummary();
    recomp = {
      totalInchesLost: rs.totalInchesLost,
      muscleProxyInchesGained: rs.muscleProxyInchesGained,
      strengthScoreCurrent: rs.strengthScoreCurrent,
      strengthScoreGoal: rs.strengthScoreGoal,
      weightLatestLbs: rs.weightLatest,
      weightBaselineLbs: rs.weightBaseline,
    };
  } catch {
    // Recomp is best-effort context; never block plan authoring on it.
    recomp = null;
  }

  // Current macro / calorie goals (user_preferences, id=1) for the nutrition brain.
  const prefRows = await db
    .select({
      calorieTarget: userPreferencesTable.calorieTarget,
      proteinTargetG: userPreferencesTable.proteinTargetG,
      carbsTargetG: userPreferencesTable.carbsTargetG,
      fatTargetG: userPreferencesTable.fatTargetG,
      bodyGoal: userPreferencesTable.bodyGoal,
    })
    .from(userPreferencesTable)
    .where(eq(userPreferencesTable.id, 1))
    .limit(1);
  const pref = prefRows[0];
  const macros: PersonalContext["macros"] = pref
    ? {
        calorieTarget: pref.calorieTarget ?? null,
        proteinTargetG: pref.proteinTargetG ?? null,
        carbsTargetG: pref.carbsTargetG ?? null,
        fatTargetG: pref.fatTargetG ?? null,
        bodyGoal: pref.bodyGoal ?? null,
      }
    : null;

  return {
    todayISO: todayISO(),
    currentWeightLbs,
    goalWeightLbs: active?.goalWeight ?? null,
    equipment: DEFAULT_EQUIPMENT,
    budget,
    recentActivitySummary: summaryParts.length ? summaryParts.join(" ") : null,
    notes: active?.notes ?? null,
    recomp,
    macros,
  };
}

type ChatTurn = { role: "user" | "assistant"; content: string };

// ---------------------------------------------------------------------------
// Phase 3: working-draft persistence. The iterative coach's plan + conversation
// live in a single-row table (id=1) so refinement survives navigation — the
// runner can leave the builder, come back, and keep refining. This is the
// scratchpad; applying writes through to planner_configs / plan_days separately.
// ---------------------------------------------------------------------------
type ChatMsg = { role: string; content: string };
interface DraftBody {
  plan?: AiPlan | null;
  messages?: ChatMsg[];
  name?: string | null;
}

// GET /api/plan-builder/draft — load the working draft (nulls when none).
router.get("/plan-builder/draft", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(planDraftsTable)
    .where(eq(planDraftsTable.id, 1))
    .limit(1);
  const row = rows[0];
  res.json({
    plan: (row?.plan as AiPlan | null) ?? null,
    messages: row?.messages ?? [],
    name: row?.name ?? null,
    updatedAt: row?.updatedAt ?? null,
  });
});

// PUT /api/plan-builder/draft — upsert the working draft (plan + conversation).
router.put("/plan-builder/draft", async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as DraftBody;
  const value = {
    id: 1,
    plan: (body.plan ?? null) as unknown,
    messages: Array.isArray(body.messages) ? body.messages : [],
    name: body.name ?? null,
    updatedAt: new Date(),
  };
  await db
    .insert(planDraftsTable)
    .values(value)
    .onConflictDoUpdate({
      target: planDraftsTable.id,
      set: { plan: value.plan, messages: value.messages, name: value.name, updatedAt: value.updatedAt },
    });
  res.json({ ok: true });
});

// DELETE /api/plan-builder/draft — clear the working draft (Start over).
router.delete("/plan-builder/draft", async (_req, res): Promise<void> => {
  await db.delete(planDraftsTable).where(eq(planDraftsTable.id, 1));
  res.json({ ok: true });
});

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
    // Params cast to any: `output_config.effort`, adaptive `thinking`, and the
    // server-side `web_search` tool are GA on the API but may not be in the
    // installed SDK's static types yet. The wire shape is correct; the cast just
    // keeps the build green.
    //
    // web_search lets the coach confirm a real Tonal program's structure at
    // runtime when the client names one that isn't in the built-in catalog
    // (Phase 2). Server-side tools run inside the same turn; a long turn can
    // come back with stop_reason "pause_turn", which we drain by re-streaming
    // with the assistant turn echoed back (bounded loop).
    const conv: Anthropic.MessageParam[] = [...messages];
    let final!: Anthropic.Message;
    for (let i = 0; i < 5; i++) {
      const params = {
        model: MODEL,
        max_tokens: 64000,
        thinking: { type: "adaptive" as const },
        // Interactive use — balance reasoning quality with latency.
        output_config: { effort: "medium" as const },
        system,
        tools: [
          PROPOSE_PLAN_TOOL,
          { type: "web_search_20260209", name: "web_search" },
        ],
        messages: conv,
      };
      const stream = getAnthropic().messages.stream(params as never, {
        signal: controller.signal,
      });
      stream.on("text", (delta: string) => send({ type: "text", text: delta }));
      final = await stream.finalMessage();
      if (final.stop_reason === "pause_turn") {
        conv.push({ role: "assistant", content: final.content });
        continue;
      }
      break;
    }

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

      // Phase 4: changing the plan in chat updates the FOOD. When the coach
      // attached macros to this proposal, persist them as the nutrition baseline
      // now (fast safety-clamp, no AI/web call) so Today + Nutrition reflect the
      // new plan immediately — no separate Goals trip, no waiting for accept.
      // Background + best-effort: never let it block or fail the chat turn.
      if (plan.nutrition) {
        const { planCtx, override } = nutritionInputsFromPlan(
          plan,
          ctx.goalWeightLbs ?? null,
        );
        void computeAndPersistBaselineBestEffort(planCtx, override).catch((err) => {
          req.log?.error({ err }, "propose-time nutrition baseline failed");
        });
      }
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

    const now = new Date();

    // Phase 3: APPLY IN PLACE. Re-applying a refined plan should UPDATE the
    // existing active AI config — not spawn a new "campaign" every tweak. If the
    // active config is already an AI plan, reuse its id and overwrite it. Only
    // when there's no active AI config (first AI apply, or switching away from a
    // template) do we mint a new config and demote the old active one.
    const activeRows = await tx
      .select({ id: plannerConfigsTable.id, source: plannerConfigsTable.source })
      .from(plannerConfigsTable)
      .where(eq(plannerConfigsTable.isActive, true))
      .limit(1);
    const activeAi = activeRows[0]?.source === "ai" ? activeRows[0] : null;

    let newId: number;
    if (activeAi) {
      // Reuse the active AI config row — same id, updated in place.
      newId = activeAi.id;
      await tx
        .update(plannerConfigsTable)
        .set({
          name,
          isActive: true,
          startDate: materialized.startDate,
          marathonDate: materialized.marathonDate,
          blocks: [],
          entries: null,
          source: "ai",
          aiPlan: plan,
          lastAppliedAt: now,
          appliedStartDate: materialized.startDate,
          appliedMarathonDate: materialized.marathonDate,
          appliedBlocks: [],
          appliedEntries: null,
          appliedAiPlan: plan,
        })
        .where(eq(plannerConfigsTable.id, newId));
    } else {
      // Single-active invariant: demote any currently-active config, mint a new.
      await tx
        .update(plannerConfigsTable)
        .set({ isActive: false })
        .where(eq(plannerConfigsTable.isActive, true));
      const [{ maxId } = { maxId: 0 }] = (
        await tx.execute<{ maxId: number | null }>(
          sql`SELECT MAX(id) AS "maxId" FROM planner_configs`,
        )
      ).rows;
      newId = (maxId ?? 0) + 1;
      await tx.insert(plannerConfigsTable).values({
        id: newId,
        name,
        isActive: true,
        // Use the snapped Monday so the stored start aligns to week 1's rest day.
        startDate: materialized.startDate,
        marathonDate: materialized.marathonDate,
        blocks: [], // engine blocks unused for ai-source configs
        entries: null,
        source: "ai",
        aiPlan: plan,
        // Snapshot immediately — this config IS being applied right now.
        lastAppliedAt: now,
        appliedStartDate: materialized.startDate,
        appliedMarathonDate: materialized.marathonDate,
        appliedBlocks: [],
        appliedEntries: null,
        appliedAiPlan: plan,
      });
    }

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
          strengthBlocks: d.strengthBlocks,
          description: d.description,
          strengthMin: d.strengthMin,
          cardioMin: d.cardioMin,
          runMin: d.runMin,
          distanceMi: d.distanceMi,
          pace: d.pace,
          sessionType: d.sessionType,
          isRest: d.isRest,
          totalLoad: d.totalLoad,
          // R4: normalized training-intensity score for the reactive
          // nutrition engine (strength heaviest, run, then cardio; rest = 0).
          plannedLoad: computePlannedLoad({
            isRest: d.isRest,
            strengthMin: d.strengthMin,
            cardioMin: d.cardioMin,
            runMin: d.runMin,
          }),
          // seed_* mirrors so the "reset to original" affordance works.
          seedSessionType: d.sessionType,
          seedEquipment: d.equipment,
          seedEquipmentList: d.equipmentList,
          seedStrengthBlocks: d.strengthBlocks,
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
      appliedInPlace: Boolean(activeAi),
      weeksSeeded: materialized.weekly.length,
      daysSeeded: materialized.days.length,
      workoutsPreserved: workoutsBefore,
      measurementsPreserved: measurementsBefore,
      undoSnapshotsWiped: snapshotsBefore,
      totalWeeks: materialized.totalWeeks,
    };
  });

  // Goal weight for the safe-rate context: prefer the prefs goal, since the
  // plan builder reads goalWeightLb there. null = no loss goal to pace.
  const prefGoalRows = await db
    .select({ goalWeightLb: userPreferencesTable.goalWeightLb })
    .from(userPreferencesTable)
    .where(eq(userPreferencesTable.id, 1))
    .limit(1);
  const latestPrefGoalWeight = prefGoalRows[0]?.goalWeightLb ?? null;

  // R4 + plan-aligned macros: accepting an AI plan auto-produces the nutrition
  // baseline so the runner doesn't make a separate Goals trip. The macros
  // reflect the plan's goal + a safe deficit, not just body-comp math.
  const { planCtx, override } = nutritionInputsFromPlan(plan, latestPrefGoalWeight);

  req.log?.warn(
    {
      configId: result.configId,
      weeksSeeded: result.weeksSeeded,
      daysSeeded: result.daysSeeded,
    },
    "claude-authored plan accepted — plan_weeks/plan_days seeded",
  );

  if (override) {
    // FAST path: the coach set the plan's macros. Just safety-clamp + persist
    // (no AI/web call) — quick enough to await so the response carries the note
    // and the runner sees the numbers immediately. THIS is what makes Accept
    // instant: the old slow case was the no-targets AI fallback below.
    const nutrition = await computeAndPersistBaselineBestEffort(planCtx, override);
    const nutritionNote = nutrition.ok
      ? `Nutrition baseline set: ${nutrition.targets.calorieTarget} kcal, ${nutrition.targets.proteinTargetG} g protein, ${nutrition.targets.carbsTargetG} g carbs, ${nutrition.targets.fatTargetG} g fat.` +
        (nutrition.targets.safety ? ` ${nutrition.targets.safety.message}` : "")
      : `Nutrition baseline not set yet — ${nutrition.message}`;
    res.json({
      ...result,
      nutritionNote,
      nutritionBaseline: nutrition.ok
        ? { computed: true, ...nutrition.targets }
        : { computed: false, reason: nutrition.reason, message: nutrition.message },
    });
    return;
  }

  // SLOW path (no plan targets → AI + web_search baseline): respond NOW so
  // Accept is instant, and compute the baseline in the BACKGROUND. The runner's
  // nutrition pages refetch on next visit and pick it up. Best-effort.
  res.json({
    ...result,
    nutritionNote: "Setting your nutrition baseline in the background…",
    nutritionBaseline: { computing: true },
  });
  void computeAndPersistBaselineBestEffort(planCtx, override).catch((err) => {
    req.log?.error({ err }, "background nutrition baseline failed");
  });
});

export default router;
