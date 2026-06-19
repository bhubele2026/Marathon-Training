import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EatToday, type DayTarget } from "./eat-today";

// R6 coverage for the reactive "Eat today" block. The component hand-fetches
// /api/nutrition/day/<date>; we stub global.fetch to drive each state.

function renderWith(payload: DayTarget) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(payload),
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <EatToday date="2026-06-19" />
    </QueryClientProvider>,
  );
  return fetchMock;
}

const fullMacros = { cal: 2300, protein: 180, carbs: 230, fat: 70 };

describe("EatToday block", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the adjusted target, the baseline→today readout, rationale, and actual progress", async () => {
    const fetchMock = renderWith({
      date: "2026-06-19",
      baseline: { ...fullMacros },
      adjusted: { cal: 2150, protein: 180, carbs: 195, fat: 68 },
      delta: { cal: -150, protein: 0, carbs: -35, fat: -2 },
      rationale: "Lighter day, so calories and carbs dip while protein holds.",
      actual: { cal: 896, protein: 70, carbs: 80, fat: 30 },
      source: "actual",
    });

    await waitFor(() =>
      expect(screen.getByTestId("card-eat-today")).toBeTruthy(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/nutrition/day/2026-06-19",
      expect.anything(),
    );
    // adjusted calories shown with actual progress (896 / 2,150).
    const card = screen.getByTestId("card-eat-today");
    expect(card.textContent).toContain("896");
    expect(card.textContent).toContain("2,150");
    // baseline → today reactivity readout.
    expect(screen.getByTestId("text-eat-today-recomp").textContent).toContain(
      "2,300",
    );
    expect(screen.getByTestId("text-eat-today-recomp").textContent).toContain(
      "2,150",
    );
    // one-line rationale.
    expect(screen.getByTestId("text-eat-today-rationale").textContent).toContain(
      "Lighter day",
    );
  });

  it("shows a Set up nutrition prompt (not a broken number) when needsBaseline", async () => {
    renderWith({
      date: "2026-06-19",
      baseline: null,
      adjusted: null,
      delta: null,
      rationale: null,
      actual: null,
      source: "planned",
      needsBaseline: true,
    });

    await waitFor(() =>
      expect(screen.getByTestId("card-eat-today-needs-baseline")).toBeTruthy(),
    );
    expect(screen.getByTestId("button-eat-today-setup")).toBeTruthy();
    // No real target number rendered.
    expect(screen.queryByTestId("card-eat-today")).toBeNull();
  });
});
