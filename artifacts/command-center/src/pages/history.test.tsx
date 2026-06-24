import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// Stub the generated React Query list hooks the History page reads. Each
// test sets the four data shapes; History composes them client-side.
vi.mock("@workspace/api-client-react", () => ({
  useListNutritionEntries: vi.fn(),
  useListWaterLogs: vi.fn(),
  useListWorkouts: vi.fn(),
  useListMeasurements: vi.fn(),
}));

import {
  useListNutritionEntries,
  useListWaterLogs,
  useListWorkouts,
  useListMeasurements,
} from "@workspace/api-client-react";
import History from "./history";

const mEntries = vi.mocked(useListNutritionEntries);
const mWater = vi.mocked(useListWaterLogs);
const mWorkouts = vi.mocked(useListWorkouts);
const mMeasurements = vi.mocked(useListMeasurements);

function setData(opts: {
  entries?: unknown[];
  water?: unknown[];
  workouts?: unknown[];
  measurements?: unknown[];
}) {
  mEntries.mockReturnValue({ data: opts.entries ?? [], isLoading: false } as never);
  mWater.mockReturnValue({ data: opts.water ?? [], isLoading: false } as never);
  mWorkouts.mockReturnValue({ data: opts.workouts ?? [], isLoading: false } as never);
  mMeasurements.mockReturnValue({
    data: opts.measurements ?? [],
    isLoading: false,
  } as never);
}

const today = (() => {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
    .toISOString()
    .slice(0, 10);
})();

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("History browser (Phase 14)", () => {
  it("renders the period header and the Day/Week/Month control", () => {
    setData({});
    render(<History />);
    expect(screen.getByText("History")).toBeTruthy();
    expect(screen.getByText("Daily")).toBeTruthy();
    expect(screen.getByText("Weekly")).toBeTruthy();
    expect(screen.getByText("Monthly")).toBeTruthy();
    expect(screen.getByTestId("history-period-label")).toBeTruthy();
  });

  it("distinguishes manual vs synced provenance on entries", () => {
    setData({
      entries: [
        { id: 1, date: today, label: "Chicken & rice", calories: 600, proteinG: 50, source: "manual" },
        { id: 2, date: today, label: "Synced totals", calories: 1800, proteinG: 120, source: "health_sync" },
      ],
    });
    render(<History />);
    expect(screen.getByTestId("badge-manual")).toBeTruthy();
    expect(screen.getByTestId("badge-synced")).toBeTruthy();
    expect(screen.getByText("Chicken & rice")).toBeTruthy();
  });

  it("shows an empty state when nothing was logged in the period", () => {
    setData({});
    render(<History />);
    expect(screen.getByText("Nothing logged this period")).toBeTruthy();
  });

  it("navigates to the previous period when ◀ is clicked", () => {
    setData({});
    render(<History />);
    const before = screen.getByTestId("history-period-label").textContent;
    fireEvent.click(screen.getByTestId("history-prev"));
    const after = screen.getByTestId("history-period-label").textContent;
    expect(after).not.toBe(before);
  });

  it("groups a logged day with its workout and water", () => {
    setData({
      entries: [{ id: 3, date: today, label: "Breakfast", calories: 400, source: "manual" }],
      water: [{ id: 9, date: today, oz: 32, source: "manual" }],
      workouts: [{ id: 7, date: today, sessionType: "Upper Body", totalMin: 45 }],
    });
    render(<History />);
    expect(screen.getByTestId(`history-day-${today}`)).toBeTruthy();
    expect(screen.getByText("Upper Body")).toBeTruthy();
    expect(screen.getByText(/32 oz water/)).toBeTruthy();
  });
});
