import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NutritionLog } from "./nutrition-log";

// Presentation coverage for the per-day nutrition log table. The component
// hand-fetches /api/nutrition/recent; we stub global.fetch to drive it.

type Entry = {
  date: string;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  sodiumMg: number | null;
  waterMl: number | null;
  source?: string | null;
};

function renderWith(entries: Entry[], props?: Parameters<typeof NutritionLog>[0]) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ days: 90, entries }),
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <NutritionLog {...props} />
    </QueryClientProvider>,
  );
  return fetchMock;
}

const entries: Entry[] = [
  {
    date: "2026-06-26",
    calories: 2150,
    proteinG: 182,
    carbsG: 210,
    fatG: 66,
    sodiumMg: 2400,
    waterMl: 2000,
  },
  {
    date: "2026-06-25",
    calories: 2310,
    proteinG: 175,
    carbsG: 240,
    fatG: 72,
    sodiumMg: 2600,
    waterMl: 1800,
  },
];

describe("NutritionLog table", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders a row per logged day with the calorie numbers", async () => {
    renderWith(entries);
    await waitFor(() =>
      expect(screen.getByTestId("log-row-2026-06-26")).toBeTruthy(),
    );
    const row = screen.getByTestId("log-row-2026-06-26");
    expect(row.textContent).toContain("2,150");
    expect(screen.getByTestId("log-row-2026-06-25").textContent).toContain("2,310");
  });

  it("shows the macro-color dots in the header", async () => {
    renderWith(entries);
    await waitFor(() =>
      expect(screen.getByTestId("log-row-2026-06-26")).toBeTruthy(),
    );
    const card = screen.getByTestId("card-nutrition-log");
    const dots = card.querySelectorAll('span[aria-hidden][style*="background"]');
    // One legend dot per macro column (calories, protein, carbs, fat, water, sodium).
    expect(dots.length).toBe(6);
  });

  it("highlights today (the most recent day by default)", async () => {
    renderWith(entries);
    await waitFor(() =>
      expect(screen.getByTestId("log-row-2026-06-26")).toBeTruthy(),
    );
    expect(
      screen.getByTestId("log-row-2026-06-26").hasAttribute("data-today"),
    ).toBe(true);
    expect(
      screen.getByTestId("log-row-2026-06-25").hasAttribute("data-today"),
    ).toBe(false);
    expect(within(screen.getByTestId("log-row-2026-06-26")).getByText("Today")).toBeTruthy();
  });

  it("honors an explicit todayDate prop over the newest row", async () => {
    renderWith(entries, { todayDate: "2026-06-25" });
    await waitFor(() =>
      expect(screen.getByTestId("log-row-2026-06-25")).toBeTruthy(),
    );
    expect(
      screen.getByTestId("log-row-2026-06-25").hasAttribute("data-today"),
    ).toBe(true);
    expect(
      screen.getByTestId("log-row-2026-06-26").hasAttribute("data-today"),
    ).toBe(false);
  });

  it("omits the Source column when no day carries provenance", async () => {
    renderWith(entries);
    await waitFor(() =>
      expect(screen.getByTestId("log-row-2026-06-26")).toBeTruthy(),
    );
    expect(screen.queryByText("Source")).toBeNull();
    expect(screen.queryByTestId("log-source-manual")).toBeNull();
    expect(screen.queryByTestId("log-source-synced")).toBeNull();
  });

  it("renders Source pills when days carry a source", async () => {
    renderWith([
      { ...entries[0]!, source: "health_sync" },
      { ...entries[1]!, source: "manual" },
    ]);
    await waitFor(() =>
      expect(screen.getByTestId("log-source-synced")).toBeTruthy(),
    );
    expect(screen.getByText("Source")).toBeTruthy();
    expect(screen.getByTestId("log-source-synced").textContent).toContain("Synced");
    expect(screen.getByTestId("log-source-manual").textContent).toContain("Manual");
  });
});
