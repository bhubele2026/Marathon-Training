import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// Mutable ref so individual tests can flip the active run-targeting mode
// (effort / intervals / pace / hr_zones) and observe RunTargetLine
// re-render with or without the HR zone color swatch on the workout
// history rows (Task #168). vi.hoisted is required because vi.mock
// factories run before top-level statements, so a plain `let` in module
// scope wouldn't be initialized when the factory closure first reads it.
const { runTargetingModeRef } = vi.hoisted(() => ({
  runTargetingModeRef: {
    current: "effort" as "effort" | "intervals" | "pace" | "hr_zones",
  },
}));

// Stub the generated React Query hooks the page imports. The page only
// reads the `data` and `isLoading` shape off the query result, so we
// return the bare minimum each test needs. `useGetUserPreferences` is
// what `RunTargetLine` reads to pick the user's chosen run-targeting
// mode — driven off the hoisted ref so swatch tests can flip the mode.
// maxHr=200 keeps the "Zone N · BPM range" string intact so swatch
// tests can also assert on the rendered text.
vi.mock("@workspace/api-client-react", () => ({
  useListWorkouts: vi.fn(),
  useDeleteWorkout: () => ({ mutate: vi.fn() }),
  useGetUserPreferences: () => ({
    data: {
      runTargetingMode: runTargetingModeRef.current,
      maxHr: 200,
      restingHr: null,
    },
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query",
  );
  return { ...actual, useQueryClient: () => ({ invalidateQueries: vi.fn() }) };
});

vi.mock("@/components/workout-form", () => ({
  WorkoutForm: () => <div data-testid="workout-form-stub" />,
}));

import { useListWorkouts } from "@workspace/api-client-react";
import { HR_ZONE_COLORS } from "@/lib/run-target";
import Log from "./log";

const mockedUseListWorkouts = vi.mocked(useListWorkouts);

function makeWorkout(over: Record<string, unknown> = {}) {
  return {
    id: 100,
    planDayId: 42,
    date: "2026-04-01",
    sessionType: "Long Run",
    equipment: "Outdoor Run",
    equipmentList: ["Outdoor Run"],
    durationMin: 60,
    strengthMin: null,
    cardioMin: null,
    runMin: 60,
    totalMin: 60,
    distanceMi: 6,
    pace: "10:00",
    avgHr: 145,
    rpe: 6,
    strengthLoad: null,
    totalLoad: 100,
    notes: null,
    timeOfDay: null,
    modality: null,
    prescribedRunTarget: null,
    createdAt: "2026-04-01T12:00:00Z",
    ...over,
  };
}

function renderWithWorkouts(rows: Array<ReturnType<typeof makeWorkout>>) {
  mockedUseListWorkouts.mockReturnValue({
    data: rows,
    isLoading: false,
  } as unknown as ReturnType<typeof useListWorkouts>);
  return render(<Log />);
}

describe("Training Log — prescribed run target column (Task #140)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    // Reset the run-targeting mode back to "effort" so subsequent tests
    // (or test files) don't inherit a stale mode from the swatch suite.
    runTargetingModeRef.current = "effort";
  });

  it("renders the prescribed run target line next to the actuals when the joined plan day is a run-shaped session", () => {
    renderWithWorkouts([
      makeWorkout({
        id: 100,
        prescribedRunTarget: {
          sessionType: "Long Run",
          week: 4,
          runMin: 60,
          distanceMi: 6,
          pace: "10:00",
        },
      }),
    ]);

    const target = screen.getByTestId("log-row-100-run-target");
    // Surface the user's chosen mode tag so they remember what they're
    // looking at — defaulted to "effort" by the hoisted ref.
    expect(target.getAttribute("data-run-targeting-mode")).toBe("effort");
    expect(target.textContent).toContain("Effort");
  });

  it("does NOT render a prescribed run target line for rows without a joined plan day (off-plan / quick-logged Lifestyle)", () => {
    renderWithWorkouts([
      makeWorkout({ id: 101, prescribedRunTarget: null }),
    ]);

    expect(screen.queryByTestId("log-row-101-run-target")).toBeNull();
  });

  it("does NOT render a prescribed run target line when the joined plan day is a non-run session (rest / strength / cardio)", () => {
    // RunTargetLine returns null when `isRunSession` is false, even if a
    // prescribedRunTarget snapshot is present. This keeps the table cell
    // tidy on Strength / Cardio days that happen to have a planDayId.
    renderWithWorkouts([
      makeWorkout({
        id: 102,
        sessionType: "Strength + Cardio",
        runMin: null,
        distanceMi: null,
        pace: null,
        prescribedRunTarget: {
          sessionType: "Strength + Cardio",
          week: 4,
          runMin: null,
          distanceMi: null,
          pace: null,
        },
      }),
    ]);

    expect(screen.queryByTestId("log-row-102-run-target")).toBeNull();
  });
});

// Locks in that the workout history row on the Log page renders the HR
// zone color swatch when the active run-targeting mode is hr_zones, and
// drops the swatch in the other three modes (effort / intervals / pace).
// Without this, a future refactor of RunTargetLine could silently drop
// the swatch on the Log page even though every other RunTargetLine
// surface (Today's Mission Brief / pre-launch first-session preview /
// Mission Accomplished card, week-detail expanded plan card, Settings
// → Run Targeting preview) keeps it (Task #168).
//
// Reaches for the public `${testId}-zone-swatch` testId hook on
// RunTargetLine rather than scraping classnames, so the test stays
// robust to Tailwind / styling changes as long as the public swatch
// contract holds.
describe("Training Log — HR zone swatch coverage (task #168)", () => {
  // Long Run on week 4 maps to intensityBucket=2 → hr_zones renders
  // "Zone 2 · 120-140 bpm" with the bg-emerald-500 swatch. The history
  // row only renders RunTargetLine when the workout has a
  // `prescribedRunTarget` snapshot, so every fixture below carries one.
  function makeRunWorkoutWithPrescribed(id: number) {
    return makeWorkout({
      id,
      prescribedRunTarget: {
        sessionType: "Long Run",
        week: 4,
        runMin: 60,
        distanceMi: 6,
        pace: "10:00",
      },
    });
  }

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    runTargetingModeRef.current = "effort";
  });

  it("renders the colored zone swatch on the workout history row when mode is hr_zones", () => {
    runTargetingModeRef.current = "hr_zones";
    renderWithWorkouts([makeRunWorkoutWithPrescribed(200)]);

    const target = screen.getByTestId("log-row-200-run-target");
    expect(target.getAttribute("data-run-targeting-mode")).toBe("hr_zones");
    // maxHr=200 + bucket=2 → "Zone 2 · 120-140 bpm"
    expect(target.textContent).toContain("Zone 2");
    expect(target.textContent).toContain("120-140 bpm");

    const swatch = screen.getByTestId("log-row-200-run-target-zone-swatch");
    expect(swatch).toBeTruthy();
    // bucket=2 → emerald-500 from HR_ZONE_COLORS. Asserted on the
    // rendered DOM so a regression in HR_ZONE_COLORS or the bucket→
    // swatch wiring is caught end-to-end, not just at the unit level.
    expect(swatch.className).toContain("bg-emerald-500");
    // Decorative — a screen reader shouldn't announce the swatch.
    expect(swatch.getAttribute("aria-hidden")).toBe("true");
  });

  it.each([
    ["effort"],
    ["intervals"],
    ["pace"],
  ])(
    "does NOT render the zone swatch on the workout history row in %s mode",
    (mode) => {
      runTargetingModeRef.current = mode as
        | "effort"
        | "intervals"
        | "pace"
        | "hr_zones";
      renderWithWorkouts([makeRunWorkoutWithPrescribed(201)]);

      const target = screen.getByTestId("log-row-201-run-target");
      expect(target.getAttribute("data-run-targeting-mode")).toBe(mode);
      expect(
        screen.queryByTestId("log-row-201-run-target-zone-swatch"),
      ).toBeNull();
    },
  );

  it("re-renders the chip with / without the swatch when the run-targeting mode flips", () => {
    runTargetingModeRef.current = "pace";
    const { rerender } = renderWithWorkouts([
      makeRunWorkoutWithPrescribed(202),
    ]);
    expect(
      screen.queryByTestId("log-row-202-run-target-zone-swatch"),
    ).toBeNull();

    // Flip the preference → swatch should appear on the next render.
    runTargetingModeRef.current = "hr_zones";
    rerender(<Log />);
    const swatch = screen.getByTestId("log-row-202-run-target-zone-swatch");
    expect(swatch).toBeTruthy();
    expect(swatch.className).toContain("bg-emerald-500");

    // Flip back to a non-HR mode → swatch should disappear again.
    runTargetingModeRef.current = "intervals";
    rerender(<Log />);
    expect(
      screen.queryByTestId("log-row-202-run-target-zone-swatch"),
    ).toBeNull();
  });
});

// Task #171: lock the full HR zone color ramp on the Log page's
// workout-history row chip. The bucket-2 swatch test above only
// exercises Long Run / week 4 → bucket 2 → bg-emerald-500, so the
// other four entries in HR_ZONE_COLORS (slate-400 / amber-400 /
// orange-500 / red-500 for buckets 1, 3, 4, 5) were only locked in by
// the unit test on the color map itself. A regression that wired the
// wrong bucket to the wrong swatch on a Recovery / Steady / Tempo /
// Interval session would slip through on this surface. This
// parametrized suite picks one representative sessionType per
// intensityBucket value, flips the active mode to hr_zones, asserts
// the row's "Zone N" prefix is present so the swatch we grab is
// unambiguously for the bucket under test, and pulls the expected
// swatch class directly from HR_ZONE_COLORS so the assertion follows
// any future re-mapping of buckets → tokens without a test edit.
describe("Training Log — every HR zone bucket renders the matching swatch (task #171)", () => {
  // sessionType → bucket pairs covering all five HR_ZONE_COLORS entries.
  // Mirrors the equivalent suite in today.test.tsx so the two surfaces
  // stay in lockstep on bucket coverage. The bucket column is the value
  // intensityBucket() should return for each sessionType; documenting
  // it here keeps the test self-checking if intensityBucket ever drifts.
  const cases: Array<{
    sessionType: string;
    bucket: 1 | 2 | 3 | 4 | 5;
  }> = [
    { sessionType: "Recovery Run", bucket: 1 },
    { sessionType: "Long Run", bucket: 2 },
    { sessionType: "Steady Run", bucket: 3 },
    { sessionType: "Tempo Run", bucket: 4 },
    { sessionType: "VO2 Intervals", bucket: 5 },
  ];

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    runTargetingModeRef.current = "effort";
  });

  it.each(cases)(
    "$sessionType (bucket $bucket) paints the matching HR_ZONE_COLORS swatch on the workout history row in hr_zones mode",
    ({ sessionType, bucket }) => {
      runTargetingModeRef.current = "hr_zones";
      // Unique row id per case so cleanup-between-cases isn't load-
      // bearing on the testId selectors below.
      const rowId = 300 + bucket;
      renderWithWorkouts([
        makeWorkout({
          id: rowId,
          sessionType,
          prescribedRunTarget: {
            sessionType,
            week: 4,
            runMin: 60,
            distanceMi: 6,
            pace: "10:00",
          },
        }),
      ]);

      const target = screen.getByTestId(`log-row-${rowId}-run-target`);
      expect(target.getAttribute("data-run-targeting-mode")).toBe("hr_zones");
      // The "Zone N" prefix proves this swatch belongs to the zone
      // we're asserting on, not some other run-target chip on the page.
      expect(target.textContent).toContain(`Zone ${bucket}`);

      const swatch = screen.getByTestId(
        `log-row-${rowId}-run-target-zone-swatch`,
      );
      // Pulled from HR_ZONE_COLORS so the assertion follows any future
      // re-mapping of buckets → tokens without needing a test edit.
      const expectedSwatchClass = HR_ZONE_COLORS[bucket].swatchClass;
      expect(swatch.className).toContain(expectedSwatchClass);
      expect(swatch.getAttribute("aria-hidden")).toBe("true");
    },
  );
});
