import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// Mutable ref so individual tests can flip the active run-targeting mode
// (effort / intervals / pace / hr_zones) and observe RunTargetLine
// re-render with or without the HR zone color swatch (Task #166).
// vi.hoisted is required because vi.mock factories run before
// top-level statements, so a plain `let` in module scope wouldn't be
// initialized when the factory closure first reads it.
const { runTargetingModeRef } = vi.hoisted(() => ({
  runTargetingModeRef: {
    current: "effort" as "effort" | "intervals" | "pace" | "hr_zones",
  },
}));

// Task #306: today eyebrow reads /race-week to detect race-week / post-
// race state. Tests can flip this ref to drive the eyebrow into each
// branch (campaign / race week / post race).
const { raceWeekRef } = vi.hoisted(() => ({
  raceWeekRef: {
    current: null as
      | { inWindow: boolean; racePassed: boolean; daysAfterRace?: number | null }
      | null,
  },
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetTodayPlan: vi.fn(),
  useGetUserPreferences: () => ({
    data: {
      runTargetingMode: runTargetingModeRef.current,
      // Provide a realistic maxHr so the hr_zones-mode primary string
      // includes the "· 134-148 bpm" suffix and the swatch test can
      // assert on a fully-rendered chip.
      maxHr: 200,
      restingHr: null,
    },
  }),
  useGetRaceWeek: () => ({ data: raceWeekRef.current, isLoading: false }),
  getGetRaceWeekQueryKey: () => ["/race-week"],
}));

vi.mock("@/hooks/use-mission-actions", () => ({
  useMissionActions: () => ({
    openLog: vi.fn(),
    openEdit: vi.fn(),
    requestDelete: vi.fn(),
    requestSkip: vi.fn(),
    crushIt: vi.fn(),
    isDeleting: false,
    isCrushing: false,
    dialogs: null,
  }),
}));

vi.mock("@/components/quick-log-activity", () => ({
  QuickLogActivity: () => <div data-testid="quick-log-stub" />,
}));

vi.mock("@/components/race-week-banner", () => ({
  ChecklistNudge: () => null,
}));

import { useGetTodayPlan } from "@workspace/api-client-react";
import { HR_ZONE_COLORS } from "@/lib/run-target";
import { TooltipProvider } from "@/components/ui/tooltip";
import Today from "./today";

const mockedUseToday = vi.mocked(useGetTodayPlan);

const firstSession = {
  id: 1,
  week: 1,
  phase: "Foundation Build",
  date: "2026-05-05",
  day: "Tue",
  strengthLoad: 60,
  equipment: "Tonal",
  description: "Heavy upper-body Tonal then easy spin",
  cardioMin: 25,
  distanceMi: null,
  pace: null,
  sessionType: "Strength + Cardio",
  isRest: false,
  totalLoad: 85,
  isCustomized: false,
  customizedFields: [],
};

const restPlan = {
  ...firstSession,
  id: 99,
  date: "2026-05-04",
  day: "Mon",
  sessionType: "Rest",
  equipment: "None",
  description: "Rest day",
  isRest: true,
  strengthLoad: 0,
  cardioMin: 0,
  totalLoad: 0,
};

function renderWithData(payload: Record<string, unknown>) {
  mockedUseToday.mockReturnValue({
    data: payload,
    isLoading: false,
  } as unknown as ReturnType<typeof useGetTodayPlan>);
  // Wrap in TooltipProvider so the race-day personalized pace chip
  // (Task #235) can mount its Radix Tooltip without throwing
  // "Tooltip must be used within TooltipProvider". The real app
  // mounts a single TooltipProvider at the App root, so this is
  // just standing in for that for the unit test render.
  return render(
    <TooltipProvider>
      <Today />
    </TooltipProvider>,
  );
}

describe("Today page — pre-launch countdown", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the countdown card on a pre-launch rest day (hasPlan=true) and hides the Mission Brief", () => {
    // Mon 2026-05-04 is a rest day at the very start of week 1, so hasPlan
    // is true even though the campaign's first real session is the next day.
    renderWithData({
      date: "2026-05-04",
      hasPlan: true,
      plan: restPlan,
      loggedWorkouts: [],
      suggestions: null,
      daysUntilStart: 1,
      firstSession,
    });

    expect(screen.getByTestId("card-campaign-countdown")).toBeTruthy();
    expect(screen.getByTestId("text-countdown-days").textContent).toBe("1");
    // "Day" singular when daysUntilStart === 1.
    expect(screen.getByText("Day")).toBeTruthy();
    expect(screen.getByTestId("text-first-session-date").textContent).toContain(
      "Tue May 5",
    );
    // The regular Mission Brief must NOT render alongside the countdown.
    expect(screen.queryByText("Mission Brief")).toBeNull();
    // The generic Rest Day empty state must also be suppressed.
    expect(screen.queryByText("Rest Day")).toBeNull();
  });

  it("shows the countdown card on a pre-launch day with no plan row", () => {
    renderWithData({
      date: "2026-05-02",
      hasPlan: false,
      plan: null,
      loggedWorkouts: [],
      suggestions: null,
      daysUntilStart: 3,
      firstSession,
    });

    expect(screen.getByTestId("text-countdown-days").textContent).toBe("3");
    expect(screen.getByText("Days")).toBeTruthy();
    expect(screen.queryByText("Rest Day")).toBeNull();
  });

  it("renders the regular Mission Brief once the campaign has started", () => {
    renderWithData({
      date: "2026-05-05",
      hasPlan: true,
      plan: firstSession,
      loggedWorkouts: [],
      suggestions: null,
      daysUntilStart: null,
      firstSession: null,
    });

    expect(screen.queryByTestId("card-campaign-countdown")).toBeNull();
    expect(screen.getByText("Mission Brief")).toBeTruthy();
  });

  // Plan-day chip rail (chip-equipment-{date}-{idx}). Mission Brief and
  // First Scheduled Session preview share the same fallback semantics.
  it("renders one chip per equipmentList entry on the Mission Brief (multi-equipment day)", () => {
    renderWithData({
      date: "2026-05-05",
      hasPlan: true,
      plan: { ...firstSession, equipmentList: ["Tonal", "Peloton Bike"] },
      loggedWorkouts: [],
      suggestions: null,
      daysUntilStart: null,
      firstSession: null,
    });

    expect(screen.getByTestId("chip-equipment-2026-05-05-0").textContent).toBe("Tonal");
    expect(screen.getByTestId("chip-equipment-2026-05-05-1").textContent).toBe("Peloton Bike");
    expect(screen.queryByTestId("chip-equipment-2026-05-05-2")).toBeNull();
  });

  it("falls back to a single [equipment] chip on the Mission Brief when equipmentList is missing", () => {
    renderWithData({
      date: "2026-05-05",
      hasPlan: true,
      plan: { ...firstSession, equipmentList: undefined },
      loggedWorkouts: [],
      suggestions: null,
      daysUntilStart: null,
      firstSession: null,
    });

    expect(screen.getByTestId("chip-equipment-2026-05-05-0").textContent).toBe("Tonal");
    expect(screen.queryByTestId("chip-equipment-2026-05-05-1")).toBeNull();
  });

  it("renders one chip per equipmentList entry on the pre-launch First Scheduled Session preview", () => {
    renderWithData({
      date: "2026-05-02",
      hasPlan: false,
      plan: null,
      loggedWorkouts: [],
      suggestions: null,
      daysUntilStart: 3,
      firstSession: { ...firstSession, equipmentList: ["Tonal", "Peloton Bike"] },
    });

    expect(screen.getByTestId("chip-equipment-2026-05-05-0").textContent).toBe("Tonal");
    expect(screen.getByTestId("chip-equipment-2026-05-05-1").textContent).toBe("Peloton Bike");
  });

  it("falls back to a single [equipment] chip on the pre-launch First Scheduled Session preview when equipmentList is missing", () => {
    renderWithData({
      date: "2026-05-02",
      hasPlan: false,
      plan: null,
      loggedWorkouts: [],
      suggestions: null,
      daysUntilStart: 3,
      firstSession: { ...firstSession, equipmentList: undefined },
    });

    expect(screen.getByTestId("chip-equipment-2026-05-05-0").textContent).toBe("Tonal");
    expect(screen.queryByTestId("chip-equipment-2026-05-05-1")).toBeNull();
  });

  // Logged-session chip rail (chip-equipment-actual-{sessionId}-{idx}).
  // Namespaced by session id so multi-session days don't collide.
  const loggedSession = {
    id: 555,
    date: "2026-05-05",
    sessionType: "Strength + Cardio",
    equipment: "Tonal",
    durationMin: 60,
    strengthMin: 35,
    cardioMin: 25,
    runMin: null,
    distanceMi: null,
    pace: null,
    avgHr: null,
    rpe: 7,
    strengthLoad: 60,
    totalLoad: 85,
    notes: null,
    timeOfDay: null,
    modality: null,
    planDayId: 1,
  };

  it("renders one chip per equipmentList entry on the logged Mission Accomplished card (multi-machine session)", () => {
    renderWithData({
      date: "2026-05-05",
      hasPlan: true,
      plan: firstSession,
      loggedWorkouts: [
        { ...loggedSession, equipmentList: ["Tonal", "Peloton Bike"] },
      ],
      suggestions: null,
      daysUntilStart: null,
      firstSession: null,
    });

    expect(
      screen.getByTestId("chip-equipment-actual-555-0").textContent,
    ).toBe("Tonal");
    expect(
      screen.getByTestId("chip-equipment-actual-555-1").textContent,
    ).toBe("Peloton Bike");
    expect(screen.queryByTestId("chip-equipment-actual-555-2")).toBeNull();
  });

  it("falls back to a single [equipment] chip on the logged Mission Accomplished card when equipmentList is missing (legacy row)", () => {
    renderWithData({
      date: "2026-05-05",
      hasPlan: true,
      plan: firstSession,
      loggedWorkouts: [{ ...loggedSession, equipmentList: undefined }],
      suggestions: null,
      daysUntilStart: null,
      firstSession: null,
    });

    expect(
      screen.getByTestId("chip-equipment-actual-555-0").textContent,
    ).toBe("Tonal");
    expect(screen.queryByTestId("chip-equipment-actual-555-1")).toBeNull();
  });

  // Task #140: the prescribed run-target line should appear next to the
  // actuals on the logged Mission Accomplished card so the runner can
  // compare what the plan asked for vs what they did. The mode hook is
  // stubbed at the top of this file to "effort", so we expect the EFFORT
  // label and an effort-bucket primary string.
  it("renders the prescribed run target on the logged Mission Accomplished card for run-shaped plan days", () => {
    const runPlan = {
      ...firstSession,
      week: 4,
      sessionType: "Long Run",
      runMin: 60,
      distanceMi: 6,
      pace: "10:00",
    };
    renderWithData({
      date: "2026-05-05",
      hasPlan: true,
      plan: runPlan,
      loggedWorkouts: [
        {
          ...loggedSession,
          sessionType: "Long Run",
          runMin: 58,
          distanceMi: 5.9,
        },
      ],
      suggestions: null,
      daysUntilStart: null,
      firstSession: null,
    });

    const target = screen.getByTestId("session-today-555-run-target");
    // The mode tag shows the user's chosen mode (mocked to "effort"
    // above) so the runner remembers which mode the plan is being
    // surfaced in.
    expect(target.getAttribute("data-run-targeting-mode")).toBe("effort");
    expect(target.textContent).toContain("Effort");
  });

  it("does NOT render a prescribed run target on the logged Mission Accomplished card for non-run plan days (rest / strength / cardio)", () => {
    // firstSession is a Strength + Cardio day with runMin/distanceMi
    // null — RunTargetLine returns null on these so the actuals card
    // stays uncluttered.
    renderWithData({
      date: "2026-05-05",
      hasPlan: true,
      plan: firstSession,
      loggedWorkouts: [loggedSession],
      suggestions: null,
      daysUntilStart: null,
      firstSession: null,
    });

    expect(screen.queryByTestId("session-today-555-run-target")).toBeNull();
  });

  // Task #143: per-program Crushed/Log/Skip buttons. With concurrent
  // overlapping programs (Task #135) every Mission Brief card must
  // expose its own action buttons so the runner can log a workout
  // against THAT program's plan_day. The lowest-index card uses the
  // legacy testIds (button-crush-today, etc.) and secondary cards
  // suffix the testId with the program's sourceEntryIndex so the
  // selectors stay stable.
  it("renders Crushed/Log/Skip buttons on every concurrent program card (task #143)", () => {
    const tonalPlan = {
      ...firstSession,
      id: 1001,
      sessionType: "Tonal Lift",
      sourceEntryIndex: 0,
      sourceEntryLabel: "Tonal Lift",
    };
    const runPlan = {
      ...firstSession,
      id: 1002,
      sessionType: "Easy Run",
      equipment: "Outdoor",
      strengthLoad: 0,
      cardioMin: 0,
      sourceEntryIndex: 1,
      sourceEntryLabel: "5K Improver",
    };
    renderWithData({
      date: "2026-05-05",
      hasPlan: true,
      plan: tonalPlan,
      plans: [tonalPlan, runPlan],
      loggedWorkouts: [],
      suggestions: null,
      daysUntilStart: null,
      firstSession: null,
    });

    // Primary card (sourceEntryIndex=0) keeps the unsuffixed testIds.
    expect(screen.getByTestId("button-crush-today")).toBeTruthy();
    expect(screen.getByTestId("button-log-today")).toBeTruthy();
    expect(screen.getByTestId("button-skip-today")).toBeTruthy();
    // Secondary card (sourceEntryIndex=1) gets its own suffixed buttons.
    expect(screen.getByTestId("button-crush-today-1")).toBeTruthy();
    expect(screen.getByTestId("button-log-today-1")).toBeTruthy();
    expect(screen.getByTestId("button-skip-today-1")).toBeTruthy();
    // Both program-name badges render so runners can tell the cards apart.
    expect(screen.getByTestId("badge-program-0").textContent).toBe("Tonal Lift");
    expect(screen.getByTestId("badge-program-1").textContent).toBe("5K Improver");
  });

  it("hides Skip and shows Crushed Another / Log Another only on the program whose plan_day was logged (task #143)", () => {
    const tonalPlan = {
      ...firstSession,
      id: 1001,
      sessionType: "Tonal Lift",
      sourceEntryIndex: 0,
      sourceEntryLabel: "Tonal Lift",
    };
    const runPlan = {
      ...firstSession,
      id: 1002,
      sessionType: "Easy Run",
      equipment: "Outdoor",
      sourceEntryIndex: 1,
      sourceEntryLabel: "5K Improver",
    };
    // A workout logged against ONLY the run program (planDayId = 1002).
    renderWithData({
      date: "2026-05-05",
      hasPlan: true,
      plan: tonalPlan,
      plans: [tonalPlan, runPlan],
      loggedWorkouts: [{ ...loggedSession, planDayId: 1002 }],
      suggestions: null,
      daysUntilStart: null,
      firstSession: null,
    });

    // Tonal card (untouched) keeps Crushed It / Log Mission / Skipped.
    expect(screen.getByTestId("button-crush-today").textContent).toContain(
      "Crushed It",
    );
    expect(screen.getByTestId("button-log-today").textContent).toContain(
      "Log Mission",
    );
    expect(screen.getByTestId("button-skip-today")).toBeTruthy();
    // Run card (logged) flips to Crushed Another / Log Another and hides Skip.
    expect(screen.getByTestId("button-crush-today-1").textContent).toContain(
      "Crushed Another",
    );
    expect(screen.getByTestId("button-log-today-1").textContent).toContain(
      "Log Another",
    );
    expect(screen.queryByTestId("button-skip-today-1")).toBeNull();
  });
});

// Task #166: end-to-end coverage that the HR-zone color swatch added in
// Task #165 actually shows up next to the "Zone N · 134-148 bpm" line on
// Today's Mission Brief expanded plan card when the active mode is
// hr_zones — and stays absent in the other three modes (effort,
// intervals, pace) so we don't accidentally start coloring all
// run-target chips. The mode-flip test proves switching the
// runTargetingMode preference re-renders the chip with / without the
// swatch as expected.
//
// We deliberately reach for the `${testId}-zone-swatch` testId hook
// exposed by RunTargetLine rather than scraping classnames, so the
// test stays robust to Tailwind / styling changes as long as the
// public swatch contract holds.
describe("Today page — HR zone swatch coverage (task #166)", () => {
  // Same run-shaped plan day used across the swatch tests. Long Run on
  // week 4 maps to intensityBucket=2, so hr_zones mode renders
  // "Zone 2 · 120-140 bpm" with the bg-emerald-500 swatch.
  const runPlan = {
    ...firstSession,
    sourceEntryIndex: 0,
    week: 4,
    sessionType: "Long Run",
    runMin: 60,
    distanceMi: 6,
    pace: "10:00",
  };

  const todayPayload = {
    date: "2026-05-05",
    hasPlan: true,
    plan: runPlan,
    loggedWorkouts: [],
    suggestions: null,
    daysUntilStart: null,
    firstSession: null,
  };

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    // Reset the run-targeting mode back to "effort" so subsequent test
    // files (or a re-run of this file) don't inherit a stale mode.
    runTargetingModeRef.current = "effort";
  });

  it("renders the colored zone swatch on the Mission Brief when the active mode is hr_zones", () => {
    runTargetingModeRef.current = "hr_zones";
    renderWithData(todayPayload);

    const target = screen.getByTestId("today-plan-0-run-target");
    expect(target.getAttribute("data-run-targeting-mode")).toBe("hr_zones");
    // maxHr=200 + bucket=2 → "Zone 2 · 120-140 bpm"
    expect(target.textContent).toContain("Zone 2");
    expect(target.textContent).toContain("120-140 bpm");

    const swatch = screen.getByTestId("today-plan-0-run-target-zone-swatch");
    expect(swatch).toBeTruthy();
    // bucket=2 → emerald token from HR_ZONE_COLORS. Asserted here so
    // the mapping locked in by run-target.test.ts is also enforced
    // end-to-end on the actual rendered DOM.
    expect(swatch.className).toContain("bg-emerald-500");
    // Decorative — a screen reader shouldn't announce the swatch.
    expect(swatch.getAttribute("aria-hidden")).toBe("true");
  });

  it.each([
    ["effort"],
    ["intervals"],
    ["pace"],
  ])(
    "does NOT render the zone swatch on the Mission Brief in %s mode",
    (mode) => {
      runTargetingModeRef.current = mode as
        | "effort"
        | "intervals"
        | "pace"
        | "hr_zones";
      renderWithData(todayPayload);

      const target = screen.getByTestId("today-plan-0-run-target");
      expect(target.getAttribute("data-run-targeting-mode")).toBe(mode);
      expect(
        screen.queryByTestId("today-plan-0-run-target-zone-swatch"),
      ).toBeNull();
    },
  );

  it("re-renders the chip with / without the swatch when the run-targeting mode flips", () => {
    runTargetingModeRef.current = "pace";
    const { rerender } = renderWithData(todayPayload);
    expect(
      screen.queryByTestId("today-plan-0-run-target-zone-swatch"),
    ).toBeNull();

    // Flip the preference → swatch should appear on the next render.
    runTargetingModeRef.current = "hr_zones";
    rerender(<Today />);
    const swatch = screen.getByTestId("today-plan-0-run-target-zone-swatch");
    expect(swatch).toBeTruthy();
    expect(swatch.className).toContain("bg-emerald-500");

    // Flip back to a non-HR mode → swatch should disappear again.
    runTargetingModeRef.current = "effort";
    rerender(<Today />);
    expect(
      screen.queryByTestId("today-plan-0-run-target-zone-swatch"),
    ).toBeNull();
  });
});

// Task #167: extend the swatch coverage from the Mission Brief card to
// the other two RunTargetLine surfaces on the Today page so a future
// refactor of `RunTargetLine` (or any of its callers) can't silently
// drop the HR-zone swatch on these surfaces:
//   * the pre-launch "First Scheduled Session" preview
//     (testId: `first-session-run-target`)
//   * the logged "Mission Accomplished" card
//     (testId: `session-today-{id}-run-target`)
// As with the Mission Brief tests we reach for the public
// `${testId}-zone-swatch` testId hook instead of scraping classnames so
// the assertion stays robust to Tailwind / styling changes.
describe("Today page — HR zone swatch coverage on first-session and logged-session surfaces (task #167)", () => {
  // Run-shaped firstSession used by the pre-launch preview tests. Long
  // Run on week 4 maps to intensityBucket=2 → hr_zones renders
  // "Zone 2 · 120-140 bpm" with the bg-emerald-500 swatch (matches the
  // Mission Brief / week-detail swatch tests above).
  const firstSessionRun = {
    ...firstSession,
    week: 4,
    sessionType: "Long Run",
    runMin: 60,
    distanceMi: 6,
    pace: "10:00",
  };

  const preLaunchPayload = {
    date: "2026-05-02",
    hasPlan: false,
    plan: null,
    loggedWorkouts: [],
    suggestions: null,
    daysUntilStart: 3,
    firstSession: firstSessionRun,
  };

  // Run-shaped plan + matching logged session for the Mission
  // Accomplished card tests. Same intensityBucket=2 as above so the
  // swatch is once again the emerald token.
  const runPlan = {
    ...firstSession,
    week: 4,
    sessionType: "Long Run",
    runMin: 60,
    distanceMi: 6,
    pace: "10:00",
  };
  const loggedRunSession = {
    id: 555,
    date: "2026-05-05",
    sessionType: "Long Run",
    equipment: "Outdoor",
    durationMin: 58,
    strengthMin: 0,
    cardioMin: 0,
    runMin: 58,
    distanceMi: 5.9,
    pace: "10:05",
    avgHr: null,
    rpe: 7,
    strengthLoad: 0,
    totalLoad: 60,
    notes: null,
    timeOfDay: null,
    modality: null,
    planDayId: 1,
  };
  const loggedPayload = {
    date: "2026-05-05",
    hasPlan: true,
    plan: runPlan,
    loggedWorkouts: [loggedRunSession],
    suggestions: null,
    daysUntilStart: null,
    firstSession: null,
  };

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    runTargetingModeRef.current = "effort";
  });

  // -----------------------------------------------------------------
  // Pre-launch First Scheduled Session preview
  // -----------------------------------------------------------------
  it("renders the colored zone swatch on the pre-launch First Scheduled Session preview when mode is hr_zones", () => {
    runTargetingModeRef.current = "hr_zones";
    renderWithData(preLaunchPayload);

    const target = screen.getByTestId("first-session-run-target");
    expect(target.getAttribute("data-run-targeting-mode")).toBe("hr_zones");
    // maxHr=200 + bucket=2 → "Zone 2 · 120-140 bpm"
    expect(target.textContent).toContain("Zone 2");
    expect(target.textContent).toContain("120-140 bpm");

    const swatch = screen.getByTestId("first-session-run-target-zone-swatch");
    expect(swatch).toBeTruthy();
    // Decorative — a screen reader shouldn't announce the swatch.
    expect(swatch.getAttribute("aria-hidden")).toBe("true");
  });

  it.each([
    ["effort"],
    ["intervals"],
    ["pace"],
  ])(
    "does NOT render the zone swatch on the pre-launch First Scheduled Session preview in %s mode",
    (mode) => {
      runTargetingModeRef.current = mode as
        | "effort"
        | "intervals"
        | "pace"
        | "hr_zones";
      renderWithData(preLaunchPayload);

      const target = screen.getByTestId("first-session-run-target");
      expect(target.getAttribute("data-run-targeting-mode")).toBe(mode);
      expect(
        screen.queryByTestId("first-session-run-target-zone-swatch"),
      ).toBeNull();
    },
  );

  // -----------------------------------------------------------------
  // Logged "Mission Accomplished" card
  // -----------------------------------------------------------------
  it("renders the colored zone swatch on the logged Mission Accomplished card when mode is hr_zones", () => {
    runTargetingModeRef.current = "hr_zones";
    renderWithData(loggedPayload);

    const target = screen.getByTestId("session-today-555-run-target");
    expect(target.getAttribute("data-run-targeting-mode")).toBe("hr_zones");
    expect(target.textContent).toContain("Zone 2");
    expect(target.textContent).toContain("120-140 bpm");

    const swatch = screen.getByTestId(
      "session-today-555-run-target-zone-swatch",
    );
    expect(swatch).toBeTruthy();
    // Decorative — a screen reader shouldn't announce the swatch.
    expect(swatch.getAttribute("aria-hidden")).toBe("true");
  });

  it.each([
    ["effort"],
    ["intervals"],
    ["pace"],
  ])(
    "does NOT render the zone swatch on the logged Mission Accomplished card in %s mode",
    (mode) => {
      runTargetingModeRef.current = mode as
        | "effort"
        | "intervals"
        | "pace"
        | "hr_zones";
      renderWithData(loggedPayload);

      const target = screen.getByTestId("session-today-555-run-target");
      expect(target.getAttribute("data-run-targeting-mode")).toBe(mode);
      expect(
        screen.queryByTestId("session-today-555-run-target-zone-swatch"),
      ).toBeNull();
    },
  );
});

// Task #170: every existing per-surface swatch test only exercises one
// bucket (Long Run / week 4 → bucket 2 → bg-emerald-500), so the other
// four entries in HR_ZONE_COLORS (slate-400 / amber-400 / orange-500 /
// red-500 for buckets 1, 3, 4, 5) were only locked in by the unit test
// on HR_ZONE_COLORS itself. A regression that wired the wrong bucket
// to the wrong swatch on a Recovery / Steady / Tempo / Interval session
// would slip through. This parametrized suite picks one representative
// sessionType per intensityBucket value, flips the active mode to
// hr_zones, and asserts the rendered swatch class matches the swatch
// pulled directly from HR_ZONE_COLORS — so the assertion stays in
// lockstep with the source map instead of re-hardcoding the Tailwind
// tokens here.
describe("Today page — every HR zone bucket renders the matching swatch (task #170)", () => {
  // sessionType → bucket pairs covering all five HR_ZONE_COLORS entries.
  // The bucket column is the value intensityBucket() should return for
  // each sessionType; documenting it here keeps the test self-checking
  // if intensityBucket ever drifts.
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
    "$sessionType (bucket $bucket) paints the matching HR_ZONE_COLORS swatch on the Mission Brief in hr_zones mode",
    ({ sessionType, bucket }) => {
      runTargetingModeRef.current = "hr_zones";
      const plan = {
        ...firstSession,
        sourceEntryIndex: 0,
        week: 4,
        sessionType,
        runMin: 60,
        distanceMi: 6,
        pace: "10:00",
      };
      renderWithData({
        date: "2026-05-05",
        hasPlan: true,
        plan,
        loggedWorkouts: [],
        suggestions: null,
        daysUntilStart: null,
        firstSession: null,
      });

      const target = screen.getByTestId("today-plan-0-run-target");
      expect(target.getAttribute("data-run-targeting-mode")).toBe("hr_zones");
      // The "Zone N" prefix proves this swatch belongs to the zone
      // we're asserting on, not some other run-target chip on the page.
      expect(target.textContent).toContain(`Zone ${bucket}`);

      const swatch = screen.getByTestId(
        "today-plan-0-run-target-zone-swatch",
      );
      // Pulled from HR_ZONE_COLORS so the assertion follows any future
      // re-mapping of buckets → tokens without needing a test edit.
      const expectedSwatchClass = HR_ZONE_COLORS[bucket].swatchClass;
      expect(swatch.className).toContain(expectedSwatchClass);
      expect(swatch.getAttribute("aria-hidden")).toBe("true");
    },
  );
});

// Task #174: extend the per-bucket swatch coverage from the Mission
// Brief (task #170) to the other two RunTargetLine surfaces on the
// Today page that previously only had single-bucket coverage:
//   * the pre-launch "First Scheduled Session" preview
//     (testId: `first-session-run-target`)
//   * the logged "Mission Accomplished" card
//     (testId: `session-today-{id}-run-target`)
// A regression that wired the wrong bucket to the wrong swatch on a
// Recovery / Steady / Tempo / Interval session would still slip through
// on those two surfaces without these parametrized suites. As with the
// task #170 suite above, the expected swatch class is pulled directly
// from `HR_ZONE_COLORS[bucket].swatchClass` so the assertion follows
// any future re-mapping without a test edit.
describe("Today page — every HR zone bucket renders the matching swatch on the pre-launch preview and logged card (task #174)", () => {
  // Same sessionType → bucket pairs as the task #170 Mission Brief
  // suite. Documenting the bucket column inline keeps the test
  // self-checking if intensityBucket ever drifts.
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

  // Reused logged session shape — only the plan's sessionType drives
  // the prescribed run-target bucket, so the logged actuals stay the
  // same across cases.
  const loggedRunSession = {
    id: 555,
    date: "2026-05-05",
    sessionType: "Long Run",
    equipment: "Outdoor",
    durationMin: 58,
    strengthMin: 0,
    cardioMin: 0,
    runMin: 58,
    distanceMi: 5.9,
    pace: "10:05",
    avgHr: null,
    rpe: 7,
    strengthLoad: 0,
    totalLoad: 60,
    notes: null,
    timeOfDay: null,
    modality: null,
    planDayId: 1,
  };

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    runTargetingModeRef.current = "effort";
  });

  it.each(cases)(
    "$sessionType (bucket $bucket) paints the matching HR_ZONE_COLORS swatch on the pre-launch First Scheduled Session preview in hr_zones mode",
    ({ sessionType, bucket }) => {
      runTargetingModeRef.current = "hr_zones";
      const firstSessionRun = {
        ...firstSession,
        week: 4,
        sessionType,
        runMin: 60,
        distanceMi: 6,
        pace: "10:00",
      };
      renderWithData({
        date: "2026-05-02",
        hasPlan: false,
        plan: null,
        loggedWorkouts: [],
        suggestions: null,
        daysUntilStart: 3,
        firstSession: firstSessionRun,
      });

      const target = screen.getByTestId("first-session-run-target");
      expect(target.getAttribute("data-run-targeting-mode")).toBe("hr_zones");
      // The "Zone N" prefix proves this swatch belongs to the zone
      // we're asserting on, not some other run-target chip on the page.
      expect(target.textContent).toContain(`Zone ${bucket}`);

      const swatch = screen.getByTestId(
        "first-session-run-target-zone-swatch",
      );
      // Pulled from HR_ZONE_COLORS so the assertion follows any future
      // re-mapping of buckets → tokens without needing a test edit.
      const expectedSwatchClass = HR_ZONE_COLORS[bucket].swatchClass;
      expect(swatch.className).toContain(expectedSwatchClass);
      expect(swatch.getAttribute("aria-hidden")).toBe("true");
    },
  );

  it.each(cases)(
    "$sessionType (bucket $bucket) paints the matching HR_ZONE_COLORS swatch on the logged Mission Accomplished card in hr_zones mode",
    ({ sessionType, bucket }) => {
      runTargetingModeRef.current = "hr_zones";
      const runPlan = {
        ...firstSession,
        week: 4,
        sessionType,
        runMin: 60,
        distanceMi: 6,
        pace: "10:00",
      };
      renderWithData({
        date: "2026-05-05",
        hasPlan: true,
        plan: runPlan,
        loggedWorkouts: [loggedRunSession],
        suggestions: null,
        daysUntilStart: null,
        firstSession: null,
      });

      const target = screen.getByTestId("session-today-555-run-target");
      expect(target.getAttribute("data-run-targeting-mode")).toBe("hr_zones");
      // The "Zone N" prefix proves this swatch belongs to the zone
      // we're asserting on, not some other run-target chip on the page.
      expect(target.textContent).toContain(`Zone ${bucket}`);

      const swatch = screen.getByTestId(
        "session-today-555-run-target-zone-swatch",
      );
      // Pulled from HR_ZONE_COLORS so the assertion follows any future
      // re-mapping of buckets → tokens without needing a test edit.
      const expectedSwatchClass = HR_ZONE_COLORS[bucket].swatchClass;
      expect(swatch.className).toContain(expectedSwatchClass);
      expect(swatch.getAttribute("aria-hidden")).toBe("true");
    },
  );
});

// Task #235: parity coverage for the personalized vs catalog race-day
// pace chip on the daily Today card. Task #228 already wired the same
// chip on the weekly /plan view (week-detail.tsx) and the API now
// returns `personalizedRacePace` on /plan/today as well — these tests
// pin down that the Today Mission Brief (and the post-log Mission
// Accomplished card) actually render the chip + override the headline
// run-target pace with the personalized value, so the morning of the
// race the runner sees the same recommendation they saw on /plan.
describe("Today page — race-day personalized pace chip (task #235)", () => {
  // Marathon race-day Sun row. raceDayLabel(distanceMi=26.2) classifies
  // this as a marathon race and the IIFE in today.tsx will render both
  // the race-day badge and the personalized chip.
  const racePlanBase = {
    id: 7001,
    week: 18,
    phase: "Race Week",
    date: "2026-09-13",
    day: "Sun",
    sessionType: "Race",
    equipment: "Outdoor",
    description: "RACE DAY — Marathon",
    strengthLoad: 0,
    strengthMin: 0,
    cardioMin: 0,
    runMin: 240,
    distanceMi: 26.2,
    pace: "10:30",
    isRest: false,
    totalLoad: 0,
    isCustomized: false,
    customizedFields: [],
    sourceEntryIndex: 0,
  };

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    runTargetingModeRef.current = "effort";
  });

  it("renders the Personalized chip and overrides the headline pace when personalizedRacePace.source = 'personalized'", () => {
    runTargetingModeRef.current = "pace";
    const racePlan = {
      ...racePlanBase,
      personalizedRacePace: {
        pace: "10:55",
        source: "personalized",
        sampleSize: 5,
        lookbackWeeks: 6,
        basisPaceSeconds: 630,
      },
    };
    renderWithData({
      date: racePlan.date,
      hasPlan: true,
      plan: racePlan,
      loggedWorkouts: [],
      suggestions: null,
      daysUntilStart: null,
      firstSession: null,
    });

    // Race-day badge alongside the personalized chip — same pair as
    // week-detail.tsx so visual parity is enforced.
    expect(screen.getByTestId(`badge-race-day-today-${racePlan.date}`)).toBeTruthy();
    const chip = screen.getByTestId(`badge-race-pace-source-today-${racePlan.date}`);
    expect(chip.getAttribute("data-pace-source")).toBe("personalized");
    expect(chip.getAttribute("data-personalized-pace")).toBe("10:55");
    expect(chip.textContent).toContain("10:55/mi");
    expect(chip.textContent).toContain("Personalized");

    // Headline run-target pace on the Mission Brief reflects the
    // personalized value (10:55), NOT the seeded catalog `plan.pace`
    // (10:30).
    const target = screen.getByTestId("today-plan-0-run-target");
    expect(target.textContent).toContain("10:55");
    expect(target.textContent).not.toContain("10:30");
  });

  it("renders the From catalog chip and falls back to the catalog pace when personalizedRacePace.source = 'catalog'", () => {
    runTargetingModeRef.current = "pace";
    const racePlan = {
      ...racePlanBase,
      personalizedRacePace: {
        pace: "10:30",
        source: "catalog",
        sampleSize: 0,
        lookbackWeeks: 6,
        basisPaceSeconds: null,
      },
    };
    renderWithData({
      date: racePlan.date,
      hasPlan: true,
      plan: racePlan,
      loggedWorkouts: [],
      suggestions: null,
      daysUntilStart: null,
      firstSession: null,
    });

    const chip = screen.getByTestId(`badge-race-pace-source-today-${racePlan.date}`);
    expect(chip.getAttribute("data-pace-source")).toBe("catalog");
    expect(chip.textContent).toContain("10:30/mi");
    expect(chip.textContent).toContain("From catalog");

    const target = screen.getByTestId("today-plan-0-run-target");
    expect(target.textContent).toContain("10:30");
  });

  // Task #237: post-log Mission Accomplished card must keep the
  // race-day badge + personalized vs catalog chip pair visible so a
  // runner who just logged the race sees the same explainer alongside
  // the actual-vs-planned readout. Mirrors the Mission Brief chip
  // expectations above but keys testIds off the logged session id.
  it("renders the race-day badge + personalized chip on the post-log Mission Accomplished card", () => {
    runTargetingModeRef.current = "pace";
    const racePlan = {
      ...racePlanBase,
      id: 7042,
      personalizedRacePace: {
        pace: "10:55",
        source: "personalized",
        sampleSize: 5,
        lookbackWeeks: 6,
        basisPaceSeconds: 630,
      },
    };
    const loggedSession = {
      id: 9001,
      date: racePlan.date,
      sessionType: "Race",
      equipment: "Outdoor",
      durationMin: 245,
      strengthMin: null,
      cardioMin: null,
      runMin: 245,
      distanceMi: 26.2,
      pace: "10:48",
      avgHr: 158,
      rpe: 9,
      strengthLoad: null,
      totalLoad: 245,
      notes: "Crossed the line.",
      timeOfDay: null,
      modality: "cardio",
      planDayId: racePlan.id,
    };
    renderWithData({
      date: racePlan.date,
      hasPlan: true,
      plan: racePlan,
      loggedWorkouts: [loggedSession],
      suggestions: null,
      daysUntilStart: null,
      firstSession: null,
    });

    expect(
      screen.getByTestId(`badge-race-day-today-session-${loggedSession.id}`),
    ).toBeTruthy();
    const chip = screen.getByTestId(
      `badge-race-pace-source-today-session-${loggedSession.id}`,
    );
    expect(chip.getAttribute("data-pace-source")).toBe("personalized");
    expect(chip.getAttribute("data-personalized-pace")).toBe("10:55");
    expect(chip.textContent).toContain("10:55/mi");
    expect(chip.textContent).toContain("Personalized");
  });

  it("renders the From catalog chip variant on the post-log Mission Accomplished card", () => {
    runTargetingModeRef.current = "pace";
    const racePlan = {
      ...racePlanBase,
      id: 7043,
      personalizedRacePace: {
        pace: "10:30",
        source: "catalog",
        sampleSize: 0,
        lookbackWeeks: 6,
        basisPaceSeconds: null,
      },
    };
    const loggedSession = {
      id: 9002,
      date: racePlan.date,
      sessionType: "Race",
      equipment: "Outdoor",
      durationMin: 250,
      strengthMin: null,
      cardioMin: null,
      runMin: 250,
      distanceMi: 26.2,
      pace: "10:33",
      avgHr: 156,
      rpe: 9,
      strengthLoad: null,
      totalLoad: 250,
      notes: null,
      timeOfDay: null,
      modality: "cardio",
      planDayId: racePlan.id,
    };
    renderWithData({
      date: racePlan.date,
      hasPlan: true,
      plan: racePlan,
      loggedWorkouts: [loggedSession],
      suggestions: null,
      daysUntilStart: null,
      firstSession: null,
    });

    const chip = screen.getByTestId(
      `badge-race-pace-source-today-session-${loggedSession.id}`,
    );
    expect(chip.getAttribute("data-pace-source")).toBe("catalog");
    expect(chip.textContent).toContain("10:30/mi");
    expect(chip.textContent).toContain("From catalog");
  });

  // Task #50: AM/PM ordering passthrough. The Today page renders
  // `loggedWorkouts` in the order returned by the API (server-side
  // sort by AM/PM tag, then createdAt asc), so the rendered DOM order
  // of the per-session cards must match the wire order. This test
  // asserts the page does NOT silently re-sort or drop sessions when
  // multiple AM/PM/Other/untagged tags are present on the same day.
  it("renders Mission Accomplished cards in the order returned by the API (AM, PM, Other, untagged)", () => {
    const sessionFor = (id: number, timeOfDay: string | null) => ({
      id,
      date: "2026-05-05",
      sessionType: "Strength + Cardio",
      equipment: "Tonal",
      durationMin: 60,
      strengthMin: 35,
      cardioMin: 25,
      runMin: null,
      distanceMi: null,
      pace: null,
      avgHr: null,
      rpe: 7,
      strengthLoad: 60,
      totalLoad: 85,
      notes: null,
      timeOfDay,
      modality: null,
      planDayId: 1,
    });
    renderWithData({
      date: "2026-05-05",
      hasPlan: true,
      plan: firstSession,
      // Wire order from the API for this scenario: AM, PM, Other,
      // untagged. The Today page renders in array order; assertions
      // below check both the per-card testId order and the time-of-day
      // badge text on each card so a regression that re-ordered the
      // map but kept the right ids would still surface.
      loggedWorkouts: [
        sessionFor(101, "AM"),
        sessionFor(102, "PM"),
        sessionFor(103, "Other"),
        sessionFor(104, null),
      ],
      suggestions: null,
      daysUntilStart: null,
      firstSession: null,
    });

    const cards = screen.getAllByTestId(/^session-today-\d+$/);
    expect(cards.map((c) => c.getAttribute("data-testid"))).toEqual([
      "session-today-101",
      "session-today-102",
      "session-today-103",
      "session-today-104",
    ]);
    expect(
      screen.getByTestId("badge-time-of-day-today-101").textContent,
    ).toContain("AM");
    expect(
      screen.getByTestId("badge-time-of-day-today-102").textContent,
    ).toContain("PM");
    expect(
      screen.getByTestId("badge-time-of-day-today-103").textContent,
    ).toContain("Other");
  });

  it("renders multiple same-slot sessions in the order returned by the API", () => {
    const sessionFor = (id: number, timeOfDay: string | null) => ({
      id,
      date: "2026-05-05",
      sessionType: "Run",
      equipment: "Outdoor",
      durationMin: 30,
      strengthMin: null,
      cardioMin: null,
      runMin: 30,
      distanceMi: 3,
      pace: "10:00",
      avgHr: 140,
      rpe: 6,
      strengthLoad: null,
      totalLoad: 30,
      notes: null,
      timeOfDay,
      modality: null,
      planDayId: 1,
    });
    renderWithData({
      date: "2026-05-05",
      hasPlan: true,
      plan: firstSession,
      // Two AM rows, then a PM row. The earlier AM row should still
      // surface above the later AM row (server orders createdAt asc
      // within a slot) and both AM rows above the PM row.
      loggedWorkouts: [
        sessionFor(201, "AM"),
        sessionFor(202, "AM"),
        sessionFor(203, "PM"),
      ],
      suggestions: null,
      daysUntilStart: null,
      firstSession: null,
    });

    const cards = screen.getAllByTestId(/^session-today-\d+$/);
    expect(cards.map((c) => c.getAttribute("data-testid"))).toEqual([
      "session-today-201",
      "session-today-202",
      "session-today-203",
    ]);
  });

  // Task #238: rare campaign-final-week edge case where the pre-launch
  // countdown's "First Scheduled Session" preview is itself the
  // race-day Sun. The pace override was already wired in Task #235 but
  // the badge + chip pair was missing — this test pins down that the
  // pre-launch preview now mirrors the Mission Brief race-day chip
  // pair so a runner whose campaign starts ON race day sees the same
  // explainer.
  it("renders the race-day badge + Personalized chip on the pre-launch First Scheduled Session preview when firstSession is a race-day", () => {
    runTargetingModeRef.current = "pace";
    const raceFirstSession = {
      ...racePlanBase,
      personalizedRacePace: {
        pace: "10:55",
        source: "personalized",
        sampleSize: 5,
        lookbackWeeks: 6,
        basisPaceSeconds: 630,
      },
    };
    renderWithData({
      date: "2026-09-12",
      hasPlan: false,
      plan: null,
      loggedWorkouts: [],
      suggestions: null,
      daysUntilStart: 1,
      firstSession: raceFirstSession,
    });

    expect(
      screen.getByTestId(`badge-race-day-first-session-${raceFirstSession.date}`),
    ).toBeTruthy();
    const chip = screen.getByTestId(
      `badge-race-pace-source-first-session-${raceFirstSession.date}`,
    );
    expect(chip.getAttribute("data-pace-source")).toBe("personalized");
    expect(chip.getAttribute("data-personalized-pace")).toBe("10:55");
    expect(chip.textContent).toContain("10:55/mi");
    expect(chip.textContent).toContain("Personalized");

    // Headline run-target on the pre-launch preview reflects the
    // personalized value (10:55) per the pace override already wired
    // in Task #235.
    const target = screen.getByTestId("first-session-run-target");
    expect(target.textContent).toContain("10:55");
    expect(target.textContent).not.toContain("10:30");
  });

  it("renders the From catalog chip on the pre-launch First Scheduled Session preview when source = 'catalog'", () => {
    runTargetingModeRef.current = "pace";
    const raceFirstSession = {
      ...racePlanBase,
      personalizedRacePace: {
        pace: "10:30",
        source: "catalog",
        sampleSize: 0,
        lookbackWeeks: 6,
        basisPaceSeconds: null,
      },
    };
    renderWithData({
      date: "2026-09-12",
      hasPlan: false,
      plan: null,
      loggedWorkouts: [],
      suggestions: null,
      daysUntilStart: 1,
      firstSession: raceFirstSession,
    });

    const chip = screen.getByTestId(
      `badge-race-pace-source-first-session-${raceFirstSession.date}`,
    );
    expect(chip.getAttribute("data-pace-source")).toBe("catalog");
    expect(chip.textContent).toContain("10:30/mi");
    expect(chip.textContent).toContain("From catalog");
  });

  it("does NOT render the race-day chip on the pre-launch preview when the first scheduled session is a normal weekday", () => {
    renderWithData({
      date: "2026-05-02",
      hasPlan: false,
      plan: null,
      loggedWorkouts: [],
      suggestions: null,
      daysUntilStart: 3,
      firstSession,
    });

    expect(
      screen.queryByTestId(`badge-race-day-first-session-${firstSession.date}`),
    ).toBeNull();
    expect(
      screen.queryByTestId(
        `badge-race-pace-source-first-session-${firstSession.date}`,
      ),
    ).toBeNull();
  });

  it("does NOT render the race-day chip on a non-race weekday plan", () => {
    runTargetingModeRef.current = "pace";
    const easyRunPlan = {
      ...firstSession,
      sourceEntryIndex: 0,
      sessionType: "Easy Run",
      description: "Easy aerobic shakeout",
      runMin: 40,
      distanceMi: 4,
      pace: "10:30",
      personalizedRacePace: null,
    };
    renderWithData({
      date: "2026-05-05",
      hasPlan: true,
      plan: easyRunPlan,
      loggedWorkouts: [],
      suggestions: null,
      daysUntilStart: null,
      firstSession: null,
    });

    expect(
      screen.queryByTestId("badge-race-day-today-2026-05-05"),
    ).toBeNull();
    expect(
      screen.queryByTestId("badge-race-pace-source-today-2026-05-05"),
    ).toBeNull();
  });
});

// Task #139: end-to-end coverage that the slim session cards on the
// Today page actually render the one headline number picked by
// `getPrimaryMetric` / `getPrimaryMetricCompare`. The unit tests on
// the helpers cover the selection rule itself; these tests pin the
// rendered DOM so a refactor of the slim-card layout (or a swap of
// PrimaryMetricDisplay's testIds) is caught here. Each surface is
// exercised with a planned-only, a logged-only, and a planned-vs-
// actual compare case so all three card states stay covered.
describe("Today page — primary metric rendering on slim cards (task #139)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------
  // Mission Brief planned card (PrimaryMetric, single-value variant)
  // testIdPrefix: `today-plan-${sourceEntryIndex}`
  // -----------------------------------------------------------------
  it("renders distance as the headline metric on a long-run Mission Brief plan card", () => {
    renderWithData({
      date: "2026-05-05",
      hasPlan: true,
      plan: {
        ...firstSession,
        sourceEntryIndex: 0,
        sessionType: "Long Run",
        runMin: 60,
        distanceMi: 8,
        strengthLoad: 0,
        cardioMin: 0,
        totalMin: 60,
      },
      loggedWorkouts: [],
      suggestions: null,
      daysUntilStart: null,
      firstSession: null,
    });

    const value = screen.getByTestId("today-plan-0-primary-metric-value");
    expect(value.textContent).toBe("8.00 mi");
    // The actual/planned compare slots are exclusive to logged cards.
    expect(
      screen.queryByTestId("today-plan-0-primary-metric-actual"),
    ).toBeNull();
  });

  it("renders total minutes as the headline metric on a mixed Mission Brief plan card", () => {
    renderWithData({
      date: "2026-05-05",
      hasPlan: true,
      plan: {
        ...firstSession,
        sourceEntryIndex: 0,
        sessionType: "Strength + Cardio",
        strengthMin: 35,
        cardioMin: 25,
        runMin: 0,
        distanceMi: null,
        totalMin: 60,
      },
      loggedWorkouts: [],
      suggestions: null,
      daysUntilStart: null,
      firstSession: null,
    });

    const value = screen.getByTestId("today-plan-0-primary-metric-value");
    // Two populated buckets (lift + cardio) with totalMin > 0 → "total"
    // kind formatted as "60 min".
    expect(value.textContent).toBe("60 min");
  });

  it("renders lift minutes as the headline metric on a Tonal-only Mission Brief plan card", () => {
    renderWithData({
      date: "2026-05-05",
      hasPlan: true,
      plan: {
        ...firstSession,
        sourceEntryIndex: 0,
        sessionType: "Tonal Lift",
        strengthMin: 45,
        cardioMin: 0,
        runMin: 0,
        distanceMi: null,
        totalMin: 45,
      },
      loggedWorkouts: [],
      suggestions: null,
      daysUntilStart: null,
      firstSession: null,
    });

    expect(
      screen.getByTestId("today-plan-0-primary-metric-value").textContent,
    ).toBe("45 min");
    // Label sits next to the value via the same testIdPrefix container.
    expect(
      screen.getByTestId("today-plan-0-primary-metric").textContent,
    ).toContain("Lift");
  });

  // -----------------------------------------------------------------
  // Pre-launch First Scheduled Session preview (PrimaryMetric, single)
  // testIdPrefix: `first-session`
  // -----------------------------------------------------------------
  it("renders the first-session headline metric on the pre-launch preview", () => {
    renderWithData({
      date: "2026-05-02",
      hasPlan: false,
      plan: null,
      loggedWorkouts: [],
      suggestions: null,
      daysUntilStart: 3,
      firstSession: {
        ...firstSession,
        sessionType: "Tonal Lift",
        strengthMin: 50,
        cardioMin: 0,
        runMin: 0,
        distanceMi: null,
        totalMin: 50,
      },
    });

    expect(
      screen.getByTestId("first-session-primary-metric-value").textContent,
    ).toBe("50 min");
  });

  // -----------------------------------------------------------------
  // Mission Accomplished compare card (PrimaryMetricCompare)
  // testIdPrefix: `session-today-${id}` → `-primary-metric-actual`
  //                                      → `-primary-metric-planned`
  // -----------------------------------------------------------------
  it("renders an actual / planned compare on a logged Mission Accomplished card matching a run plan day", () => {
    const runPlan = {
      ...firstSession,
      sessionType: "Long Run",
      runMin: 60,
      distanceMi: 6,
      strengthLoad: 0,
      cardioMin: 0,
      totalMin: 60,
    };
    renderWithData({
      date: "2026-05-05",
      hasPlan: true,
      plan: runPlan,
      loggedWorkouts: [
        {
          id: 555,
          date: "2026-05-05",
          sessionType: "Long Run",
          equipment: "Outdoor",
          durationMin: 58,
          strengthMin: 0,
          cardioMin: 0,
          runMin: 58,
          distanceMi: 5.2,
          pace: "10:05",
          avgHr: null,
          rpe: 7,
          strengthLoad: 0,
          totalLoad: 60,
          notes: null,
          timeOfDay: null,
          modality: null,
          planDayId: 1,
        },
      ],
      suggestions: null,
      daysUntilStart: null,
      firstSession: null,
    });

    // Plan picked the kind (distance), so the logged card displays
    // miles even though the runner could have only logged minutes.
    expect(
      screen.getByTestId("session-today-555-primary-metric-actual").textContent,
    ).toBe("5.20 mi");
    expect(
      screen.getByTestId("session-today-555-primary-metric-planned")
        .textContent,
    ).toContain("6.00 mi");
    // Single-value testid is reserved for the non-compare variant.
    expect(
      screen.queryByTestId("session-today-555-primary-metric-value"),
    ).toBeNull();
  });

  it("renders an actual / planned compare on a logged Mission Accomplished card for a mixed lift+cardio day (minutes)", () => {
    const liftPlan = {
      ...firstSession,
      sessionType: "Strength + Cardio",
      strengthMin: 35,
      cardioMin: 25,
      runMin: 0,
      distanceMi: null,
      totalMin: 60,
    };
    renderWithData({
      date: "2026-05-05",
      hasPlan: true,
      plan: liftPlan,
      loggedWorkouts: [
        {
          id: 777,
          date: "2026-05-05",
          sessionType: "Strength + Cardio",
          equipment: "Tonal",
          durationMin: 50,
          strengthMin: 30,
          cardioMin: 20,
          runMin: 0,
          distanceMi: null,
          pace: null,
          avgHr: null,
          rpe: 6,
          strengthLoad: 50,
          totalLoad: 70,
          notes: null,
          timeOfDay: null,
          modality: null,
          planDayId: 1,
          totalMin: 50,
        },
      ],
      suggestions: null,
      daysUntilStart: null,
      firstSession: null,
    });

    expect(
      screen.getByTestId("session-today-777-primary-metric-actual").textContent,
    ).toBe("50 min");
    expect(
      screen.getByTestId("session-today-777-primary-metric-planned")
        .textContent,
    ).toContain("60 min");
  });

  it("renders the actual headline with no planned counterpart when a logged session has no matching plan numbers (logged-only compare)", () => {
    // Rest-day plan + a quick-logged Lifestyle row → planned side has
    // nothing positive to display, so getPrimaryMetricCompare picks the
    // kind off the actual and omits the planned slot.
    renderWithData({
      date: "2026-05-04",
      hasPlan: true,
      plan: restPlan,
      loggedWorkouts: [
        {
          id: 888,
          date: "2026-05-04",
          sessionType: "Lifestyle",
          equipment: "Lifestyle",
          durationMin: 30,
          strengthMin: 0,
          cardioMin: 0,
          runMin: 0,
          distanceMi: null,
          pace: null,
          avgHr: null,
          rpe: null,
          strengthLoad: 0,
          totalLoad: 0,
          notes: null,
          timeOfDay: null,
          modality: null,
          planDayId: null,
        },
      ],
      suggestions: null,
      daysUntilStart: null,
      firstSession: null,
    });

    expect(
      screen.getByTestId("session-today-888-primary-metric-actual").textContent,
    ).toBe("30 min");
    expect(
      screen.queryByTestId("session-today-888-primary-metric-planned"),
    ).toBeNull();
  });
});

// Task #306: per-kind eyebrow above the "Today's Mission" header
// mirrors the dashboard / plan / week-detail framing so a runner on
// half / 10K / 5K plans doesn't bounce between consistent dashboard
// / plan / week-detail framing and a generic Today page. Tonal-first
// / non-race plans (raceKind null) render no eyebrow at all.
describe("Today page — per-kind eyebrow (task #306)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    raceWeekRef.current = null;
  });

  function basePayload(extras: Record<string, unknown>) {
    return {
      date: "2026-05-05",
      hasPlan: true,
      plan: firstSession,
      loggedWorkouts: [],
      suggestions: null,
      daysUntilStart: null,
      firstSession: null,
      ...extras,
    };
  }

  it("renders no eyebrow when raceKind is null (tonal-first plan)", () => {
    raceWeekRef.current = null;
    renderWithData(basePayload({ raceKind: null }));
    expect(screen.queryByTestId("today-eyebrow")).toBeNull();
  });

  it.each([
    { kind: "5k", label: "5K Campaign" },
    { kind: "10k", label: "10K Campaign" },
    { kind: "half", label: "Half Marathon Campaign" },
    { kind: "marathon", label: "Race Campaign" },
  ])("renders '$label' for raceKind=$kind outside race week", ({ kind, label }) => {
    raceWeekRef.current = { inWindow: false, racePassed: false };
    renderWithData(basePayload({ raceKind: kind }));
    const eyebrow = screen.getByTestId("today-eyebrow");
    expect(eyebrow.textContent).toBe(label);
    expect(eyebrow.getAttribute("data-race-week")).toBeNull();
    expect(eyebrow.getAttribute("data-post-race")).toBeNull();
  });

  it.each([
    { kind: "5k", label: "5K · Race Week" },
    { kind: "10k", label: "10K · Race Week" },
    { kind: "half", label: "Half Marathon · Race Week" },
    { kind: "marathon", label: "Race Week" },
  ])("renders '$label' during race week for raceKind=$kind", ({ kind, label }) => {
    raceWeekRef.current = { inWindow: true, racePassed: false };
    renderWithData(basePayload({ raceKind: kind }));
    const eyebrow = screen.getByTestId("today-eyebrow");
    expect(eyebrow.textContent).toBe(label);
    expect(eyebrow.getAttribute("data-race-week")).toBe("true");
    expect(eyebrow.getAttribute("data-post-race")).toBeNull();
  });

  it.each([
    { kind: "5k", label: "5K Complete" },
    { kind: "10k", label: "10K Complete" },
    { kind: "half", label: "Half Marathon Complete" },
    { kind: "marathon", label: "Race Complete" },
  ])("renders '$label' after the race for raceKind=$kind", ({ kind, label }) => {
    raceWeekRef.current = { inWindow: true, racePassed: true, daysAfterRace: 2 };
    renderWithData(basePayload({ raceKind: kind }));
    const eyebrow = screen.getByTestId("today-eyebrow");
    expect(eyebrow.textContent).toBe(label);
    expect(eyebrow.getAttribute("data-race-week")).toBeNull();
    expect(eyebrow.getAttribute("data-post-race")).toBe("true");
  });
});
