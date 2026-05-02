import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@workspace/api-client-react", () => ({
  useGetTodayPlan: vi.fn(),
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

  // Task #77 chip rail: each machine the runner uses today renders as its
  // own chip with a deterministic test id `chip-equipment-{date}-{idx}`.
  // Both call sites — the Mission Brief and the pre-launch countdown's
  // First Scheduled Session preview — share the same fallback semantics:
  // when `equipmentList` is missing or empty the chip rail collapses to a
  // single `[equipment]` chip so a legacy row never renders zero chips.
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
});
