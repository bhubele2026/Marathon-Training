import { test, expect, type APIRequestContext } from "@playwright/test";
import { Client } from "pg";

// Task #351: end-to-end coverage of the dashboard's next-race chip that
// Task #348 added (mirroring the chip already on /today). Drives the
// live api-server + web workflows via the shared proxy:
//   - schedules a future 5K via POST /api/scheduled-races and asserts
//     the chip appears on / with the expected copy and href
//   - re-schedules the same race for "today" (the server-computed date
//     from /api/plan/today) and asserts the "Race Today · 5K" variant
//   - clears every scheduled race and asserts the chip disappears
//
// Run against the locally-running workflows:
//   pnpm --filter @workspace/e2e-tests run test:e2e

test.describe.configure({ mode: "serial" });

const CHIP = "dashboard-chip-next-scheduled-race";

test.describe("Dashboard next-scheduled-race chip (Task #351)", () => {
  test.beforeAll(async ({ request }) => {
    await clearScheduledRaces();
    // The dashboard chip only renders inside the normal dashboard UI
    // (i.e. when a plan has been applied). Make sure that's true before
    // we start exercising the chip — if the EmptyPlanState CTA is up,
    // the chip never reaches the DOM.
    await ensurePlanApplied(request);
  });

  test.afterAll(async () => {
    await clearScheduledRaces();
  });

  test("no scheduled races → no chip on /", async ({ page }) => {
    await clearScheduledRaces();
    await page.goto("/");
    await expect(page.getByTestId("dashboard-header")).toBeVisible();
    await expect(page.getByTestId(CHIP)).toHaveCount(0);
  });

  test("future 5K → chip renders with 'Next race · 5K · in N days' and links to /races", async ({
    page,
    request,
  }) => {
    await clearScheduledRaces();
    const today = await fetchServerToday(request);
    const raceDate = isoPlusDays(today, 30);

    const create = await request.post("/api/scheduled-races", {
      data: { raceDate, raceKind: "5k", name: "E2E Tune-up 5K" },
    });
    expect(
      create.ok(),
      `POST /api/scheduled-races failed: ${create.status()} ${await create.text()}`,
    ).toBeTruthy();

    await page.goto("/");
    const chip = page.getByTestId(CHIP);
    await expect(chip).toBeVisible();
    await expect(chip).toContainText("Next race");
    await expect(chip).toContainText("5K");
    await expect(chip).toContainText("in 30 days");
    await expect(chip).toHaveAttribute("href", "/races");
    await expect(chip).toHaveAttribute("data-race-date", raceDate);
    await expect(chip).toHaveAttribute("data-race-kind", "5k");
    await expect(chip).toHaveAttribute("data-days-until", "30");
  });

  test("race scheduled for today → 'Race Today · 5K' variant renders", async ({
    page,
    request,
  }) => {
    await clearScheduledRaces();
    const today = await fetchServerToday(request);

    const create = await request.post("/api/scheduled-races", {
      data: { raceDate: today, raceKind: "5k", name: "E2E Race Day 5K" },
    });
    expect(
      create.ok(),
      `POST /api/scheduled-races failed: ${create.status()} ${await create.text()}`,
    ).toBeTruthy();

    await page.goto("/");
    const chip = page.getByTestId(CHIP);
    await expect(chip).toBeVisible();
    await expect(chip).toContainText("Race Today");
    await expect(chip).toContainText("5K");
    await expect(chip).toHaveAttribute("data-race-date", today);
    await expect(chip).toHaveAttribute("data-days-until", "0");
    await expect(chip).toHaveAttribute("href", "/races");
  });

  test("past-dated scheduled race (date already passed) → no chip", async ({
    page,
    request,
  }) => {
    // The server filters nextScheduledRace with `raceDate >= today`
    // (artifacts/api-server/src/routes/plan.ts fetchNextScheduledRace),
    // so a race whose date has already come and gone must not surface
    // the chip even though the row is still stored. We seed the past
    // row directly via the API (POST /api/scheduled-races accepts any
    // ISO date — there's no server-side past-date guard) and assert
    // the dashboard renders no chip.
    await clearScheduledRaces();
    const today = await fetchServerToday(request);
    const pastDate = isoPlusDays(today, -1);

    const create = await request.post("/api/scheduled-races", {
      data: { raceDate: pastDate, raceKind: "5k", name: "E2E Past 5K" },
    });
    expect(
      create.ok(),
      `POST /api/scheduled-races failed: ${create.status()} ${await create.text()}`,
    ).toBeTruthy();

    // Sanity-check that the past row really is stored — otherwise the
    // "no chip" assertion below would be a vacuous truth (same as the
    // empty-state test above).
    const list = await request.get("/api/scheduled-races");
    expect(list.ok()).toBeTruthy();
    const rows = (await list.json()) as Array<{ raceDate: string }>;
    expect(
      rows.find((r) => r.raceDate === pastDate),
      "past scheduled race was not persisted; the no-chip assertion would be vacuous",
    ).toBeTruthy();

    await page.goto("/");
    await expect(page.getByTestId("dashboard-header")).toBeVisible();
    await expect(page.getByTestId(CHIP)).toHaveCount(0);
  });

  test("deleting the scheduled race removes the chip from /", async ({
    page,
    request,
  }) => {
    await clearScheduledRaces();
    const today = await fetchServerToday(request);
    const raceDate = isoPlusDays(today, 14);

    const create = await request.post("/api/scheduled-races", {
      data: { raceDate, raceKind: "5k" },
    });
    expect(create.ok()).toBeTruthy();

    await page.goto("/");
    await expect(page.getByTestId(CHIP)).toBeVisible();

    const del = await request.delete(`/api/scheduled-races/${raceDate}`);
    expect(
      del.ok(),
      `DELETE /api/scheduled-races/${raceDate} failed: ${del.status()} ${await del.text()}`,
    ).toBeTruthy();

    await page.goto("/");
    await expect(page.getByTestId("dashboard-header")).toBeVisible();
    await expect(page.getByTestId(CHIP)).toHaveCount(0);
  });
});

// --- Helpers ---------------------------------------------------------------

async function clearScheduledRaces(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  test.skip(
    !databaseUrl,
    "DATABASE_URL not set; cannot reset scheduled_races between tests",
  );
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    // race_results FK-references scheduled_races by race_date; clear it
    // first so we never trip the FK and so a leftover result row from a
    // prior run doesn't flip hasResult on our newly-created chip.
    await client.query(`DELETE FROM race_results`);
    await client.query(`DELETE FROM scheduled_races`);
  } finally {
    await client.end();
  }
}

async function fetchServerToday(request: APIRequestContext): Promise<string> {
  const res = await request.get("/api/plan/today");
  expect(
    res.ok(),
    `GET /api/plan/today failed: ${res.status()} ${await res.text()}`,
  ).toBeTruthy();
  const body = (await res.json()) as { date: string };
  expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  return body.date;
}

function isoPlusDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function ensurePlanApplied(request: APIRequestContext): Promise<void> {
  const overview = await request.get("/api/plan/overview");
  if (overview.ok()) {
    const body = (await overview.json()) as { hasPlan?: boolean };
    if (body.hasPlan) return;
  }
  // Mirror applyFreshConfig in empty-plan-ui.spec.ts: minimal 8-week
  // Tonal upper-body config + the auto-pinned 16-week MARATHON_TAIL.
  const today = await fetchServerToday(request);
  const startDate = nextMondayISO(today);
  const totalDays = (8 + 16) * 7 - 1;
  const marathonDate = isoPlusDays(startDate, totalDays);
  const createRes = await request.post("/api/planner/configs", {
    data: {
      name: "E2E Next-Race Chip",
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

function nextMondayISO(fromIso: string): string {
  const d = new Date(`${fromIso}T00:00:00Z`);
  const dow = d.getUTCDay();
  const offset = ((1 - dow + 7) % 7) || 7;
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
