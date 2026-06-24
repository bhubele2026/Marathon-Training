import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { NutritionEntryForm } from "./nutrition-entry-form";

function withClient(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("NutritionEntryForm", () => {
  it("opens, takes macros, and POSTs a manual entry to /api/nutrition/entries", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({
        id: 1,
        date: "2099-06-01",
        loggedAt: "2099-06-01T12:00:00.000Z",
        label: "Eggs",
        calories: 300,
        proteinG: 24,
        carbsG: null,
        fatG: null,
        sodiumMg: null,
        source: "manual",
        createdAt: "2099-06-01T12:00:00.000Z",
        updatedAt: "2099-06-01T12:00:00.000Z",
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(withClient(<NutritionEntryForm date="2099-06-01" />));

    // Opens the dialog.
    fireEvent.click(screen.getByTestId("nutrition-entry-open"));
    expect(screen.getByTestId("nutrition-entry-calories")).toBeTruthy();

    fireEvent.change(screen.getByTestId("nutrition-entry-label"), {
      target: { value: "Eggs" },
    });
    fireEvent.change(screen.getByTestId("nutrition-entry-calories"), {
      target: { value: "300" },
    });
    fireEvent.change(screen.getByTestId("nutrition-entry-protein"), {
      target: { value: "24" },
    });
    fireEvent.click(screen.getByTestId("nutrition-entry-submit"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const calls = fetchMock.mock.calls as unknown as Array<Array<unknown>>;
    const urls = calls.map((c) => {
      const first = c[0] as { url?: string } | string | undefined;
      return typeof first === "string" ? first : (first?.url ?? "");
    });
    expect(urls.some((u) => u.includes("/nutrition/entries"))).toBe(true);
  });

  it("disables submit until at least one macro is entered", () => {
    render(withClient(<NutritionEntryForm />));
    fireEvent.click(screen.getByTestId("nutrition-entry-open"));
    const submit = screen.getByTestId("nutrition-entry-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("nutrition-entry-calories"), {
      target: { value: "300" },
    });
    expect(submit.disabled).toBe(false);
  });
});
