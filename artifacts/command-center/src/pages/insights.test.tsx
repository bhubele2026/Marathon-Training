import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

// Stub the generated list hooks; the page composes them client-side.
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
import Insights from "./insights";

const mEntries = vi.mocked(useListNutritionEntries);
const mWater = vi.mocked(useListWaterLogs);
const mWorkouts = vi.mocked(useListWorkouts);
const mMeasurements = vi.mocked(useListMeasurements);

function setData(opts: {
  entries?: unknown[];
  water?: unknown[];
  workouts?: unknown[];
  measurements?: unknown[];
  loading?: boolean;
}) {
  const loading = opts.loading ?? false;
  mEntries.mockReturnValue({ data: opts.entries ?? [], isLoading: loading } as never);
  mWater.mockReturnValue({ data: opts.water ?? [], isLoading: loading } as never);
  mWorkouts.mockReturnValue({ data: opts.workouts ?? [], isLoading: loading } as never);
  mMeasurements.mockReturnValue({
    data: opts.measurements ?? [],
    isLoading: loading,
  } as never);
}

function renderWithClient(ui: ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const today = (() => {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
    .toISOString()
    .slice(0, 10);
})();

beforeEach(() => {
  // /api/goals targets fetch.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
        JSON.stringify({ calorieTarget: 2150, proteinTargetG: 185, goalKind: "fat_loss" }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("Insights (Phase 16)", () => {
  it("renders the header and the Daily/Weekly/Monthly scale control", () => {
    setData({});
    renderWithClient(<Insights />);
    expect(screen.getByText("Insights")).toBeTruthy();
    expect(screen.getByText("Daily")).toBeTruthy();
    expect(screen.getByText("Weekly")).toBeTruthy();
    expect(screen.getByText("Monthly")).toBeTruthy();
  });

  it("shows an honest empty state when nothing is logged", () => {
    setData({});
    renderWithClient(<Insights />);
    expect(screen.getByText(/Not enough logged yet/i)).toBeTruthy();
    expect(screen.queryByTestId("insights-findings")).toBeNull();
  });

  it("renders ranked findings citing real numbers when data exists", async () => {
    const ds = Array.from({ length: 5 }, (_, i) => {
      const d = new Date(`${today}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() - i);
      return d.toISOString().slice(0, 10);
    });
    setData({
      entries: ds.map((date) => ({ date, calories: 2000, proteinG: 120 })),
      workouts: ds.slice(0, 2).map((date) => ({ date, totalMin: 45 })),
    });
    renderWithClient(<Insights />);
    // The /api/goals targets resolve async; the protein finding (which cites
    // the target) appears once it does.
    await waitFor(() =>
      expect(
        screen.getByTestId("insights-findings").textContent,
      ).toContain("120 g/day vs 185 g target"),
    );
  });

  it("switches the analysis scale when Monthly is picked", () => {
    setData({});
    renderWithClient(<Insights />);
    // Default scale is Weekly.
    expect(screen.getAllByText(/last 8 weeks/i).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("Monthly"));
    expect(screen.getAllByText(/last 6 months/i).length).toBeGreaterThan(0);
  });
});
