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

import { useGetTodayPlan } from "@workspace/api-client-react";
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
  return render(<Today />);
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
