import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { Client } from "pg";

// Task #309: end-to-end coverage of the empty-plan UI introduced by
// Task #307. Wipes the plan via Full Reset, asserts the EmptyPlanState
// CTA appears on each of the four plan-driven pages and successfully
// navigates to /planner, then applies a fresh PlannerConfig via the
// API and confirms normal plan UI returns on every page.
//
// Task #326: Full Reset is now scorched-earth on its own — it demotes
// every applied planner config back to draft state, so this spec no
// longer needs to TRUNCATE planner_configs ahead of time. Driving the
// Full Reset UI is enough to land in the empty-plan state.
//
// Run against the locally-running workflows:
//   pnpm --filter @workspace/e2e-tests run test:e2e
// Override the target with E2E_BASE_URL=https://<your-deployment>.

// Per-page testIds for the shared EmptyPlanState surface. The CTA in
// every case is `${testId}-cta` and navigates to /planner.
const EMPTY_STATE = {
  plan: "plan-empty-plan",
  dashboard: "dashboard-empty-plan",
  today: "today-empty-plan",
  week: "week-empty-plan",
} as const;

test.describe.configure({ mode: "serial" });

test.describe("Empty plan UI (Task #309)", () => {
  // Task #327: fresh-install regression — simulates a database that
  // has NEVER had POST /api/planner/apply called against it (no
  // last_applied_at anywhere) WITHOUT going through Full Reset. The
  // pre-Task-#307 auto-seed bug silently populated plan_weeks/plan_days
  // on a database where no runner had ever applied a config; Full Reset
  // is the wrong tool to reproduce that condition because it triggers
  // its own scorched-earth code path. We TRUNCATE the relevant tables
  // directly via the same DATABASE_URL the api-server uses, then assert
  // the EmptyPlanState CTA is rendered on every plan-driven page. Apply
  // a fresh config at the end and put the DB back to a usable shape
  // for any subsequent runs.
  test("fresh-install (no apply ever called, no Full Reset) → empty state on every page", async ({
    page,
    request,
  }) => {
    const databaseUrl = process.env.DATABASE_URL;
    test.skip(
      !databaseUrl,
      "DATABASE_URL not set; cannot exercise the fresh-install path",
    );

    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      // Detach FKs first, then TRUNCATE every table that an applied
      // config or its downstream workouts/measurements/checklist could
      // have populated. This mirrors the never-installed state without
      // touching the Full Reset endpoint.
      await client.query(
        `UPDATE workouts SET plan_day_id = NULL WHERE plan_day_id IS NOT NULL`,
      );
      await client.query(
        `TRUNCATE plan_days, plan_weeks, planner_configs, workouts, body_measurements, race_week_checklist, race_results, reset_undo_snapshots RESTART IDENTITY CASCADE`,
      );
    } finally {
      await client.end();
    }

    await page.goto("/plan");
    await expect(page.getByTestId(EMPTY_STATE.plan)).toBeVisible();
    await expect(page.getByTestId("plan-header-subtitle")).toContainText(
      "No plan applied yet",
    );

    await page.goto("/");
    await expect(page.getByTestId(EMPTY_STATE.dashboard)).toBeVisible();

    await page.goto("/today");
    await expect(page.getByTestId(EMPTY_STATE.today)).toBeVisible();

    await page.goto("/plan/1");
    await expect(page.getByTestId(EMPTY_STATE.week)).toBeVisible();
    await expect(page.getByTestId(EMPTY_STATE.week)).toContainText(
      "Week not found",
    );

    // Restore a usable state for downstream e2e runs in this same DB.
    await applyFreshConfig(request);
  });


  test("Full Reset → empty state on every page → apply config → normal UI returns", async ({
    page,
    request,
  }) => {
    // ---- 1. Wipe the plan via the /plan Danger Zone Full Reset UI -------
    // Task #326: Full Reset alone is enough — no direct DB truncate.
    await page.goto("/plan");
    await page
      .getByTestId("button-full-reset")
      .last()
      .scrollIntoViewIfNeeded();
    await page.getByTestId("button-full-reset").last().click();
    await page
      .getByTestId("input-confirm-full-reset")
      .fill("WIPE EVERYTHING");
    await page.getByTestId("button-confirm-full-reset").click();

    // The dialog closes and /plan re-renders into its empty state.
    await expect(page.getByTestId(EMPTY_STATE.plan)).toBeVisible();

    // ---- 2. /plan empty state + CTA → /planner --------------------------
    await expect(page).toHaveURL(/\/plan(\?|$)/);
    await expect(page.getByTestId("plan-header-subtitle")).toContainText(
      "No plan applied yet",
    );
    await assertEmptyStateAndNavigates(page, EMPTY_STATE.plan);

    // ---- 3. / dashboard empty state + CTA → /planner --------------------
    await page.goto("/");
    await assertEmptyStateAndNavigates(page, EMPTY_STATE.dashboard);

    // ---- 4. /today empty state + CTA → /planner -------------------------
    await page.goto("/today");
    await assertEmptyStateAndNavigates(page, EMPTY_STATE.today);

    // ---- 5. /plan/1 week-detail empty state + CTA → /planner ------------
    await page.goto("/plan/1");
    await expect(page.getByTestId(EMPTY_STATE.week)).toBeVisible();
    await expect(page.getByTestId(EMPTY_STATE.week)).toContainText(
      "Week not found",
    );
    await assertEmptyStateAndNavigates(page, EMPTY_STATE.week);

    // ---- 6. Apply a fresh PlannerConfig via the API ---------------------
    // Driving the planner UI's Create-then-Apply flow is unreliable today
    // (see follow-up task #312: the planner-empty-state quick-create flow
    // leaves the Apply button disabled). Hitting the API directly keeps
    // this regression test focused on what Task #309 set out to cover —
    // the empty-state surface and its recovery.
    await applyFreshConfig(request);

    // ---- 7. Verify every page exits the empty state ---------------------
    await page.goto("/plan");
    await expect(page.getByTestId(EMPTY_STATE.plan)).toHaveCount(0);
    await expect(page.getByTestId("plan-header-subtitle")).not.toContainText(
      "No plan applied yet",
    );

    await page.goto("/");
    await expect(page.getByTestId(EMPTY_STATE.dashboard)).toHaveCount(0);

    await page.goto("/today");
    await expect(page.getByTestId(EMPTY_STATE.today)).toHaveCount(0);

    await page.goto("/plan/1");
    await expect(page.getByTestId(EMPTY_STATE.week)).toHaveCount(0);
  });
});

async function assertEmptyStateAndNavigates(
  page: Page,
  testId: string,
): Promise<void> {
  const empty = page.getByTestId(testId);
  await expect(empty).toBeVisible();
  const cta = page.getByTestId(`${testId}-cta`);
  await expect(cta).toBeVisible();
  await expect(cta).toContainText("Open Phase Planner");
  await cta.click();
  await expect(page).toHaveURL(/\/planner(\?|$)/);
}

// Build a minimal valid PlannerConfig (8 user weeks of Tonal upper-body
// + the auto-pinned 16-week MARATHON_TAIL) and apply it. Mirrors the
// shape produced by `defaultBlankConfig("upper")` in
// artifacts/command-center/src/pages/planner.tsx.
async function applyFreshConfig(request: APIRequestContext): Promise<void> {
  const startDate = nextMondayISO(new Date());
  const totalDays = (8 + 16) * 7 - 1;
  const marathonDate = isoPlusDays(startDate, totalDays);

  const createRes = await request.post("/api/planner/configs", {
    data: {
      name: "E2E Empty Plan Test",
      startDate,
      marathonDate,
      blocks: [
        {
          focusType: "Custom",
          weeks: 8,
          customName: "Tonal Strength — Upper",
          customNotes: "[lift-primary:upper]",
        },
      ],
      setActive: true,
    },
  });
  expect(
    createRes.ok(),
    `POST /api/planner/configs failed: ${createRes.status()} ${await createRes.text()}`,
  ).toBeTruthy();

  const applyRes = await request.post("/api/planner/apply", { data: {} });
  expect(
    applyRes.ok(),
    `POST /api/planner/apply failed: ${applyRes.status()} ${await applyRes.text()}`,
  ).toBeTruthy();
}

function nextMondayISO(from: Date): string {
  const d = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
  );
  // Monday = 1; advance to the next Monday strictly after `from`.
  const dow = d.getUTCDay();
  const offset = ((1 - dow + 7) % 7) || 7;
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function isoPlusDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

