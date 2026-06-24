import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

vi.mock("wouter", () => ({
  Link: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import { DashboardFuelTile } from "./dashboard-fuel-tile";
import { DashboardWaterTile } from "./dashboard-water-tile";

function withClient(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

function mockFetch(payload: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => payload,
    })),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DashboardFuelTile", () => {
  it("renders the calorie ring once a day target with macros loads", async () => {
    mockFetch({
      date: "2026-06-24",
      adjusted: { cal: 2200, protein: 180, carbs: 200, fat: 70 },
      actual: { cal: 1400, protein: 120, carbs: 110, fat: 40 },
    });
    render(withClient(<DashboardFuelTile />));
    expect(await screen.findByText("Calories")).toBeTruthy();
  });

  it("shows an empty state when no baseline is set", async () => {
    mockFetch({ date: "2026-06-24", adjusted: null, needsBaseline: true });
    render(withClient(<DashboardFuelTile />));
    expect(await screen.findByText(/No fuel targets yet/i)).toBeTruthy();
  });
});

describe("DashboardWaterTile", () => {
  it("renders the water tracker from the recent feed", async () => {
    mockFetch({
      days: 90,
      entries: [{ date: "2026-06-24", waterMl: 1500 }],
    });
    render(withClient(<DashboardWaterTile weightLb={190} />));
    expect(await screen.findByText("Water")).toBeTruthy();
  });
});
