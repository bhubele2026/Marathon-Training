import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("wouter", () => ({
  useParams: () => ({ week: "1" }),
  useLocation: () => ["/plan/1", vi.fn()] as const,
}));

// Mutable ref so individual tests can flip the active run-targeting mode
// (effort / intervals / pace / hr_zones) and observe RunTargetLine
// re-render with or without the HR zone color swatch on the week-detail
// expanded plan card (Task #166). vi.hoisted is required because vi.mock
// factories run before top-level statements, so a plain `let` in module
// scope wouldn't be initialized when the factory closure first reads it.
const { runTargetingModeRef } = vi.hoisted(() => ({
  runTargetingModeRef: {
    current: "effort" as "effort" | "intervals" | "pace" | "hr_zones",
  },
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetPlanWeek: vi.fn(),
  useListWorkouts: () => ({ data: [] }),
  useResetPlanDay: () => ({ mutate: vi.fn(), isPending: false }),
  useResetPlanWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useUndoPlanReset: () => ({ mutate: vi.fn(), isPending: false }),
  // RunTargetLine pulls runTargetingMode + maxHr/restingHr off this hook
  // via use-run-targeting-mode. maxHr=200 keeps the Zone N · BPM range
  // string intact so swatch tests can also assert on the rendered text.
  useGetUserPreferences: () => ({
    data: {
      runTargetingMode: runTargetingModeRef.current,
      maxHr: 200,
      restingHr: null,
    },
  }),
  getGetPlanWeekQueryKey: () => ["plan-week"],
  getListWorkoutsQueryKey: () => ["workouts"],
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
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

vi.mock("@/lib/invalidate-mission-queries", () => ({
  invalidateMissionRelatedQueries: vi.fn(),
}));

import { useGetPlanWeek } from "@workspace/api-client-react";
import WeekDetail from "./week-detail";

const mockWeek = vi.mocked(useGetPlanWeek);

function renderWith(week: unknown) {
  mockWeek.mockReturnValue({
    data: week,
    isLoading: false,
  } as unknown as ReturnType<typeof useGetPlanWeek>);
  return render(<WeekDetail />);
}

describe("Week detail — bike/row cardio summary (task #109)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows actual / planned cardio minutes on bike-only weeks", () => {
    renderWith({
      week: 1,
      phase: "Bike Block",
      startDate: "2026-05-04",
      endDate: "2026-05-10",
      plannedStrength: 0,
      plannedCardio: 180,
      plannedTotalLoad: 0,
      plannedMiles: 0,
      longRunMi: 0,
      actualMiles: 0,
      actualCardio: 95,
      completedSessions: 1,
      totalSessions: 3,
      missedSessions: 0,
      dominantCardioEquipment: "Peloton Bike",
      days: [],
    });
    const headline = screen.getByTestId("week-volume-cardio-actual");
    expect(headline.textContent).toContain("95 / 180 min cardio");
    // Task #112: partial cardio actual → amber tint.
    expect(headline.getAttribute("data-adherence")).toBe("in-progress");
    expect(headline.className).toContain("amber");
    expect(screen.queryByTestId("week-volume-miles")).toBeNull();
  });

  it("colors the cardio headline green when the runner hits planned minutes", () => {
    renderWith({
      week: 1,
      phase: "Bike Block",
      startDate: "2026-05-04",
      endDate: "2026-05-10",
      plannedStrength: 0,
      plannedCardio: 180,
      plannedTotalLoad: 0,
      plannedMiles: 0,
      longRunMi: 0,
      actualMiles: 0,
      actualCardio: 180,
      completedSessions: 3,
      totalSessions: 3,
      missedSessions: 0,
      dominantCardioEquipment: "Peloton Bike",
      days: [],
    });
    const headline = screen.getByTestId("week-volume-cardio-actual");
    expect(headline.getAttribute("data-adherence")).toBe("met");
    expect(headline.className).toContain("emerald");
  });

  it("keeps a future cardio week neutral (0 actual)", () => {
    renderWith({
      week: 1,
      phase: "Bike Block",
      startDate: "2026-05-04",
      endDate: "2026-05-10",
      plannedStrength: 0,
      plannedCardio: 180,
      plannedTotalLoad: 0,
      plannedMiles: 0,
      longRunMi: 0,
      actualMiles: 0,
      actualCardio: 0,
      completedSessions: 0,
      totalSessions: 3,
      missedSessions: 0,
      dominantCardioEquipment: "Peloton Bike",
      days: [],
    });
    const headline = screen.getByTestId("week-volume-cardio-actual");
    expect(headline.getAttribute("data-adherence")).toBe("neutral");
    expect(headline.className).not.toContain("emerald");
    expect(headline.className).not.toContain("amber");
  });

  it("keeps the mileage headline on run-based weeks", () => {
    renderWith({
      week: 2,
      phase: "Run Block",
      startDate: "2026-05-11",
      endDate: "2026-05-17",
      plannedStrength: 0,
      plannedCardio: 0,
      plannedTotalLoad: 0,
      plannedMiles: 20,
      longRunMi: 8,
      actualMiles: 12,
      actualCardio: 0,
      completedSessions: 1,
      totalSessions: 4,
      missedSessions: 0,
      dominantCardioEquipment: null,
      days: [],
    });
    const headline = screen.getByTestId("week-volume-miles");
    expect(headline).toBeTruthy();
    // Task #112: 12 / 20 planned miles → amber tint.
    expect(headline.getAttribute("data-adherence")).toBe("in-progress");
    expect(headline.className).toContain("amber");
    expect(screen.queryByTestId("week-volume-cardio-actual")).toBeNull();
  });

  it("colors the mileage headline green when planned miles are met", () => {
    renderWith({
      week: 2,
      phase: "Run Block",
      startDate: "2026-05-11",
      endDate: "2026-05-17",
      plannedStrength: 0,
      plannedCardio: 0,
      plannedTotalLoad: 0,
      plannedMiles: 20,
      longRunMi: 8,
      actualMiles: 21,
      actualCardio: 0,
      completedSessions: 4,
      totalSessions: 4,
      missedSessions: 0,
      dominantCardioEquipment: null,
      days: [],
    });
    const headline = screen.getByTestId("week-volume-miles");
    expect(headline.getAttribute("data-adherence")).toBe("met");
    expect(headline.className).toContain("emerald");
  });
});

// Task #166: end-to-end coverage that the HR-zone color swatch added in
// Task #165 actually shows up next to the "Zone N · 134-148 bpm" line on
// the week-detail expanded plan card when the active mode is hr_zones —
// and stays absent in the other three modes (effort, intervals, pace).
// Pairs with the Today-page coverage in today.test.tsx so we have at
// least one prominent surface (Today) AND one secondary surface (the
// week-detail expanded plan card) protected against regressions in the
// HR_ZONE_COLORS swatch contract.
//
// Reaches for the public `${testId}-zone-swatch` testId hook on
// RunTargetLine rather than scraping classnames, so the test stays
// robust to Tailwind / styling changes.
describe("Week detail — HR zone swatch coverage (task #166)", () => {
  // Long Run on week 4 maps to intensityBucket=2 → hr_zones renders
  // "Zone 2 · 120-140 bpm" with the bg-emerald-500 swatch. Field set
  // mirrors PlanDayWithSuggestions closely enough for the day card
  // render path (non-rest, non-customized, no logged sessions).
  const runDay = {
    id: 1,
    week: 4,
    phase: "Foundation Build",
    date: "2026-05-05",
    day: "Tue",
    sessionType: "Long Run",
    description: "Long aerobic effort",
    equipment: "Outdoor",
    equipmentList: ["Outdoor"],
    isRest: false,
    isCustomized: false,
    customizedFields: [],
    customizedDiff: [],
    strengthLoad: 0,
    strengthMin: 0,
    cardioMin: 0,
    runMin: 60,
    distanceMi: 6,
    pace: "10:00",
    totalMin: 60,
    totalLoad: 60,
    sourceEntryIndex: 0,
    sourceEntryLabel: null,
    suggestions: null,
  };

  const weekPayload = {
    week: 4,
    phase: "Foundation Build",
    startDate: "2026-05-04",
    endDate: "2026-05-10",
    plannedStrength: 0,
    plannedCardio: 0,
    plannedTotalLoad: 60,
    plannedMiles: 6,
    longRunMi: 6,
    actualMiles: 0,
    actualCardio: 0,
    completedSessions: 0,
    totalSessions: 1,
    missedSessions: 0,
    dominantCardioEquipment: null,
    days: [runDay],
  };

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    runTargetingModeRef.current = "effort";
  });

  it("renders the colored zone swatch on the expanded plan card when mode is hr_zones", () => {
    runTargetingModeRef.current = "hr_zones";
    renderWith(weekPayload);

    const target = screen.getByTestId("day-2026-05-05-run-target");
    expect(target.getAttribute("data-run-targeting-mode")).toBe("hr_zones");
    // maxHr=200 + bucket=2 → "Zone 2 · 120-140 bpm"
    expect(target.textContent).toContain("Zone 2");
    expect(target.textContent).toContain("120-140 bpm");

    const swatch = screen.getByTestId("day-2026-05-05-run-target-zone-swatch");
    expect(swatch).toBeTruthy();
    // bucket=2 → emerald-500 from HR_ZONE_COLORS. Asserted on the
    // rendered DOM so a regression in HR_ZONE_COLORS or the bucket→
    // swatch wiring is caught end-to-end, not just at the unit level.
    expect(swatch.className).toContain("bg-emerald-500");
    expect(swatch.getAttribute("aria-hidden")).toBe("true");
  });

  it.each([
    ["effort"],
    ["intervals"],
    ["pace"],
  ])(
    "does NOT render the zone swatch on the expanded plan card in %s mode",
    (mode) => {
      runTargetingModeRef.current = mode as
        | "effort"
        | "intervals"
        | "pace"
        | "hr_zones";
      renderWith(weekPayload);

      const target = screen.getByTestId("day-2026-05-05-run-target");
      expect(target.getAttribute("data-run-targeting-mode")).toBe(mode);
      expect(
        screen.queryByTestId("day-2026-05-05-run-target-zone-swatch"),
      ).toBeNull();
    },
  );

  it("re-renders the chip with / without the swatch when the run-targeting mode flips", () => {
    runTargetingModeRef.current = "pace";
    const { rerender } = renderWith(weekPayload);
    expect(
      screen.queryByTestId("day-2026-05-05-run-target-zone-swatch"),
    ).toBeNull();

    runTargetingModeRef.current = "hr_zones";
    rerender(<WeekDetail />);
    const swatch = screen.getByTestId("day-2026-05-05-run-target-zone-swatch");
    expect(swatch).toBeTruthy();
    expect(swatch.className).toContain("bg-emerald-500");

    runTargetingModeRef.current = "intervals";
    rerender(<WeekDetail />);
    expect(
      screen.queryByTestId("day-2026-05-05-run-target-zone-swatch"),
    ).toBeNull();
  });
});
