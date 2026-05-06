import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { Client } from "pg";

// Task #309: end-to-end coverage of the empty-plan UI introduced by
// Task #307. Wipes the plan via Full Reset, asserts the EmptyPlanState
// CTA appears on each of the four plan-driven pages and successfully
// navigates to /planner, then applies a fresh PlannerConfig via the
// API and confirms normal plan UI returns on every page.
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
  test("Full Reset → empty state on every page → apply config → normal UI returns", async ({
    page,
    request,
  }) => {
    // ---- 0. Truncate planner_configs directly so /plan/full-reset hits its
    // Task #307 codepath (no last-applied config → empty plan tables).
    // The HTTP API can't help here: DELETE /api/planner/configs/:id refuses
    // to remove the only remaining row. Hitting the dev DB directly is the
    // simplest way to put the system into the "fresh install" state this
    // test needs to exercise.
    await truncatePlannerConfigs();

    // ---- 1. Wipe the plan via the /plan Danger Zone Full Reset UI -------
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

async function truncatePlannerConfigs(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL must be set so the e2e test can put the planner_configs table into the fresh-install state required by Task #307.",
    );
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("TRUNCATE TABLE planner_configs RESTART IDENTITY CASCADE");
  } finally {
    await client.end();
  }
}
