import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("wouter", () => ({
  useParams: () => ({ week: "1" }),
  useLocation: () => ["/plan/1", vi.fn()] as const,
  useSearch: () => "",
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
import { HR_ZONE_COLORS } from "@/lib/run-target";
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

// Task #173: lock the full HR zone color ramp on the Week Detail
// expanded plan card's run-target chip. The bucket-2 swatch test above
// only exercises Long Run / week 4 → bucket 2 → bg-emerald-500, so the
// other four entries in HR_ZONE_COLORS (slate-400 / amber-400 /
// orange-500 / red-500 for buckets 1, 3, 4, 5) were only locked in by
// the unit test on the color map itself. A regression that wired the
// wrong bucket to the wrong swatch on a Recovery / Steady / Tempo /
// Interval session would slip through on this surface. This
// parametrized suite picks one representative sessionType per
// intensityBucket value, flips the active mode to hr_zones, asserts
// the chip's "Zone N" prefix is present so the swatch we grab is
// unambiguously for the bucket under test, and pulls the expected
// swatch class directly from HR_ZONE_COLORS so the assertion follows
// any future re-mapping of buckets → tokens without a test edit.
// Mirrors the equivalent suites in today.test.tsx (task #170) and
// log.test.tsx (task #171).
describe("Week detail — every HR zone bucket renders the matching swatch (task #173)", () => {
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

  // Same shape as the runDay used by the bucket-2 suite above, but
  // declared here so each case can swap in its own sessionType without
  // mutating shared state across iterations.
  function makeRunDay(sessionType: string) {
    return {
      id: 1,
      week: 4,
      phase: "Foundation Build",
      date: "2026-05-05",
      day: "Tue",
      sessionType,
      description: "Run prescription",
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
  }

  function makeWeekPayload(sessionType: string) {
    return {
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
      days: [makeRunDay(sessionType)],
    };
  }

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    runTargetingModeRef.current = "effort";
  });

  it.each(cases)(
    "$sessionType (bucket $bucket) paints the matching HR_ZONE_COLORS swatch on the expanded plan card in hr_zones mode",
    ({ sessionType, bucket }) => {
      runTargetingModeRef.current = "hr_zones";
      renderWith(makeWeekPayload(sessionType));

      const target = screen.getByTestId("day-2026-05-05-run-target");
      expect(target.getAttribute("data-run-targeting-mode")).toBe("hr_zones");
      // The "Zone N" prefix proves this swatch belongs to the zone
      // we're asserting on, not some other run-target chip on the page.
      expect(target.textContent).toContain(`Zone ${bucket}`);

      const swatch = screen.getByTestId(
        "day-2026-05-05-run-target-zone-swatch",
      );
      // Pulled from HR_ZONE_COLORS so the assertion follows any future
      // re-mapping of buckets → tokens without needing a test edit.
      const expectedSwatchClass = HR_ZONE_COLORS[bucket].swatchClass;
      expect(swatch.className).toContain(expectedSwatchClass);
      expect(swatch.getAttribute("aria-hidden")).toBe("true");
    },
  );
});

// Task #199: pin the race-day Card accent + badge presence on the Week
// Detail day card whenever a day's `sessionType` is "Race". Both
// hybrid (Task #192) and non-hybrid (Pfitz / Higdon) marathon plans
// emit `session_type: "Race"` on the campaign-final Sunday, so a
// single rendered scenario covers both plan shapes uniformly. A
// negative case on a Long Run day in the same payload guards against
// the visual treatment leaking onto non-race days.
//
// NOTE: Task #201 superseded the old generic "Race Day" pill with a
// per-kind label chip ("Marathon Day" / "Half Marathon Day" / etc.)
// rendered off the same `badge-race-day-${date}` testid. The Task
// #199 assertions below have been retargeted to expect the per-kind
// label so this suite stays green alongside the dedicated Task #201
// per-kind suite further down. The amber Card accent + data-race-day
// attribute are still owned by Task #199's wiring on the <Card>.
describe("Week detail — race-day badge on the marathon Sunday (task #199)", () => {
  function makeRaceWeekPayload() {
    const base = {
      week: 18,
      phase: "Marathon-Specific",
      startDate: "2026-06-22",
      endDate: "2026-06-28",
      plannedStrength: 30,
      plannedCardio: 15,
      plannedTotalLoad: 60,
      plannedMiles: 30,
      longRunMi: 26.2,
      actualMiles: 0,
      actualCardio: 0,
      completedSessions: 0,
      totalSessions: 3,
      missedSessions: 0,
      dominantCardioEquipment: null,
      wedSteady: false,
    };
    const longRunSat = {
      id: 100,
      week: 18,
      phase: "Marathon-Specific",
      date: "2026-06-27",
      day: "Sat",
      sessionType: "Long Run",
      description: "Final taper long run",
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
    const raceSun = {
      id: 101,
      week: 18,
      phase: "Marathon-Specific",
      date: "2026-06-28",
      day: "Sun",
      sessionType: "Race",
      description:
        "RACE DAY — Marathon (26.2 mi). Execute race plan, fuel every 4 mi, finish strong.",
      equipment: "Outdoor",
      equipmentList: ["Outdoor"],
      isRest: false,
      isCustomized: false,
      customizedFields: [],
      customizedDiff: [],
      strengthLoad: 0,
      strengthMin: 0,
      cardioMin: 0,
      runMin: 314,
      distanceMi: 26.2,
      pace: "12:00",
      totalMin: 314,
      totalLoad: 314,
      sourceEntryIndex: 0,
      sourceEntryLabel: null,
      suggestions: null,
    };
    return { ...base, days: [longRunSat, raceSun] };
  }

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the race-day badge and amber accent on the Sunday with sessionType=Race", () => {
    renderWith(makeRaceWeekPayload());

    // The pill itself: testid keyed on the day date so the assertion
    // pins the exact day card that should carry the marker. Task
    // #201 replaced the generic "Race Day" copy with a per-kind
    // label, so the marathon Sunday surfaces "Marathon Day" here.
    const badge = screen.getByTestId("badge-race-day-2026-06-28");
    expect(badge).toBeTruthy();
    expect(badge.textContent).toContain("Marathon Day");

    // The Card's amber accent — pinned via the data-race-day hook so
    // the test stays robust to Tailwind class re-shuffles, with a
    // belt-and-braces check on the amber border class so a regression
    // that drops the visual treatment but keeps the data attr is also
    // caught.
    const card = screen.getByTestId("day-card-2026-06-28");
    expect(card.getAttribute("data-race-day")).toBe("true");
    expect(card.className).toContain("amber");
  });

  it("does NOT render the race-day badge on non-race days in the same week", () => {
    renderWith(makeRaceWeekPayload());

    // The Saturday Long Run shares the same week payload but must not
    // pick up the race-day treatment — the badge is keyed strictly on
    // sessionType === "Race" (and the generator's "RACE DAY — "
    // description prefix), not on long-run distance or proximity to
    // the marathon Sunday.
    expect(screen.queryByTestId("badge-race-day-2026-06-27")).toBeNull();
    const satCard = screen.getByTestId("day-card-2026-06-27");
    expect(satCard.getAttribute("data-race-day")).toBeNull();
  });
});

// Task #201: per-kind race-day Sunday badge on the Week Detail day
// card. Task #191 already updates the generator to emit per-kind
// race-day Sundays at the right distance / description prefix
// ("RACE DAY — 5K (3.1 mi). ...", etc.) and `week-detail.tsx`
// already renders `day.distanceMi` and `day.description` straight
// from the API. This suite pins the per-kind LABEL chip
// (raceDayLabel → "5K Day" / "10K Day" / "Half Marathon Day" /
// "Marathon Day") that headlines the day card so a half / 10K / 5K
// race-day Sunday no longer reads as a generic "Race" row.
//
// One case per real race kind so a regression in either the
// raceDayLabel mapping OR the JSX badge wiring is caught at the
// rendered-DOM level. Non-race-day rows are also covered so the
// badge stays absent on regular Long Run / Easy Run cards.
describe("Week detail — per-kind race-day Sunday badge (task #201)", () => {
  function makeRaceDay(distanceMi: number, description: string) {
    return {
      id: 7,
      week: 16,
      phase: "Marathon-Specific",
      date: "2026-08-30",
      day: "Sun",
      sessionType: "Race",
      description,
      equipment: "Outdoor",
      equipmentList: ["Outdoor"],
      isRest: false,
      isCustomized: false,
      customizedFields: [],
      customizedDiff: [],
      strengthLoad: 0,
      strengthMin: 0,
      cardioMin: 0,
      runMin: Math.round(distanceMi * 11),
      distanceMi,
      pace: null,
      totalMin: Math.round(distanceMi * 11),
      totalLoad: 100,
      sourceEntryIndex: 0,
      sourceEntryLabel: null,
      suggestions: null,
    };
  }

  function makeRaceWeekPayload(distanceMi: number, description: string) {
    return {
      week: 16,
      phase: "Marathon-Specific",
      startDate: "2026-08-24",
      endDate: "2026-08-30",
      plannedStrength: 0,
      plannedCardio: 0,
      plannedTotalLoad: 100,
      plannedMiles: distanceMi,
      longRunMi: distanceMi,
      actualMiles: 0,
      actualCardio: 0,
      completedSessions: 0,
      totalSessions: 1,
      missedSessions: 0,
      dominantCardioEquipment: null,
      days: [makeRaceDay(distanceMi, description)],
    };
  }

  const cases: Array<{
    kind: "5k" | "10k" | "half" | "marathon";
    distanceMi: number;
    description: string;
    label: string;
  }> = [
    {
      kind: "5k",
      distanceMi: 3.1,
      description:
        "RACE DAY — 5K (3.1 mi). Execute race plan at VO2 effort, go hard from the gun, finish strong.",
      label: "5K Day",
    },
    {
      kind: "10k",
      distanceMi: 6.2,
      description:
        "RACE DAY — 10K (6.2 mi). Execute race plan at threshold effort, hold form, finish strong.",
      label: "10K Day",
    },
    {
      kind: "half",
      distanceMi: 13.1,
      description:
        "RACE DAY — Half (13.1 mi). Execute race plan, fuel every 4 mi, finish strong.",
      label: "Half Marathon Day",
    },
    {
      kind: "marathon",
      distanceMi: 26.2,
      description:
        "RACE DAY — Marathon (26.2 mi). Execute race plan, fuel every 4 mi, finish strong.",
      label: "Marathon Day",
    },
  ];

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it.each(cases)(
    "$kind race-day Sunday renders the $label badge with the right distance",
    ({ kind, distanceMi, description, label }) => {
      renderWith(makeRaceWeekPayload(distanceMi, description));

      const badge = screen.getByTestId("badge-race-day-2026-08-30");
      expect(badge.textContent).toContain(label);
      expect(badge.getAttribute("data-race-kind")).toBe(kind);

      // Description body still surfaces the generator's per-kind copy
      // verbatim so the runner sees the full prescription beneath the
      // badge. Asserted on the rendered card so a regression in the
      // <p>{day.description}</p> wiring is caught here, not just at
      // the API contract level.
      const card = screen.getByTestId("day-card-2026-08-30");
      expect(card.textContent).toContain(description);
    },
  );

  it("does NOT render the race-day badge on a regular Long Run row", () => {
    const longRunDay = {
      ...makeRaceDay(8, "Long aerobic effort"),
      sessionType: "Long Run",
    };
    renderWith({
      ...makeRaceWeekPayload(8, "Long aerobic effort"),
      days: [longRunDay],
    });
    expect(screen.queryByTestId("badge-race-day-2026-08-30")).toBeNull();
  });

  // Regression for a real classification bug caught in code review:
  // an early version of `raceDayLabel` fell back to distance-only
  // matching, which would mis-paint a "Half Marathon Day" badge onto
  // a 13.1 mi long run (and similarly for 3.1 / 6.2 / 26.2 mi rows
  // that aren't races). Pin every canonical race distance against a
  // non-race sessionType + non-race description so a future
  // regression is caught at the rendered-DOM level, not just inside
  // the helper's unit tests.
  it.each([
    { distanceMi: 3.1, sessionType: "Recovery Run", description: "Easy shakeout" },
    { distanceMi: 6.2, sessionType: "Steady Run", description: "Steady aerobic effort" },
    { distanceMi: 13.1, sessionType: "Long Run", description: "Long aerobic effort — fuel practice" },
    { distanceMi: 26.2, sessionType: "Long Run", description: "Peak training day" },
  ])(
    "does NOT mis-paint the race-day badge on a $sessionType at canonical race distance $distanceMi mi",
    ({ distanceMi, sessionType, description }) => {
      const day = {
        ...makeRaceDay(distanceMi, description),
        sessionType,
      };
      renderWith({
        ...makeRaceWeekPayload(distanceMi, description),
        days: [day],
      });
      expect(screen.queryByTestId("badge-race-day-2026-08-30")).toBeNull();
    },
  );
});
