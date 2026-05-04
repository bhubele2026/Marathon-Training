import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// Task #167: lock in HR-zone swatch coverage on the Settings → Run
// Targeting / Heart-rate zones preview surface. The Settings preview
// renders one swatch per zone bucket (1-5) using HR_ZONE_COLORS — the
// same color map RunTargetLine pulls from — so a future refactor of
// either side could silently drop the swatch on this surface.
//
// Matches the contract from task-167.md: swatches appear when the
// active mode is `hr_zones` (the only mode where the color ramp is
// meaningful) and are absent in the other three modes (effort,
// intervals, pace). The BPM range column remains visible across all
// modes so the preview table is still informative when picking modes;
// only the colored swatch is gated.
//
// Mutable refs so individual tests can flip the active run-targeting
// mode AND the saved maxHr per test. vi.hoisted is required because
// vi.mock factories run before top-level statements.
const { runTargetingModeRef, maxHrRef } = vi.hoisted(() => ({
  runTargetingModeRef: {
    current: "effort" as "effort" | "intervals" | "pace" | "hr_zones",
  },
  maxHrRef: { current: 200 as number | null },
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetUserPreferences: () => ({
    data: {
      runTargetingMode: runTargetingModeRef.current,
      maxHr: maxHrRef.current,
      restingHr: null,
    },
    isLoading: false,
  }),
  useUpdateUserPreferences: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  getGetUserPreferencesQueryKey: () => ["user-preferences"],
  UserPreferencesRunTargetingMode: {
    effort: "effort",
    intervals: "intervals",
    hr_zones: "hr_zones",
    pace: "pace",
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import Settings from "./settings";

describe("Settings — HR zone swatch coverage on the Run Targeting preview (task #167)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    runTargetingModeRef.current = "effort";
    maxHrRef.current = 200;
  });

  it("renders all five zone-preview swatches when the active mode is hr_zones", () => {
    runTargetingModeRef.current = "hr_zones";
    maxHrRef.current = 200;
    render(<Settings />);

    // Reach for the public testIds rather than scraping classnames so
    // the assertion stays robust to Tailwind / styling changes as long
    // as the swatch contract holds.
    for (const bucket of [1, 2, 3, 4, 5] as const) {
      const swatch = screen.getByTestId(`zone-preview-swatch-${bucket}`);
      expect(swatch).toBeTruthy();
      // Decorative — a screen reader shouldn't announce the swatch.
      expect(swatch.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it.each([
    ["effort"],
    ["intervals"],
    ["pace"],
  ])(
    "does NOT render the zone-preview swatches in %s mode (BPM ranges still render)",
    (mode) => {
      runTargetingModeRef.current = mode as
        | "effort"
        | "intervals"
        | "pace"
        | "hr_zones";
      maxHrRef.current = 200;
      render(<Settings />);

      // Swatches gated on hr_zones — absent in every other mode.
      for (const bucket of [1, 2, 3, 4, 5] as const) {
        expect(
          screen.queryByTestId(`zone-preview-swatch-${bucket}`),
        ).toBeNull();
      }
      // …but the BPM range column stays visible so the preview table
      // is still informative while the user is picking a mode.
      for (const bucket of [1, 2, 3, 4, 5] as const) {
        expect(
          screen.getByTestId(`zone-preview-range-${bucket}`),
        ).toBeTruthy();
      }
    },
  );

  it("does NOT render the zone-preview swatches when maxHr is unset (no preview table to show)", () => {
    // Without a configured max HR the Settings preview table is hidden
    // entirely (there are no BPM ranges to render), so the swatches
    // shouldn't appear either even when the user is on hr_zones mode.
    runTargetingModeRef.current = "hr_zones";
    maxHrRef.current = null;
    render(<Settings />);

    for (const bucket of [1, 2, 3, 4, 5] as const) {
      expect(
        screen.queryByTestId(`zone-preview-swatch-${bucket}`),
      ).toBeNull();
    }
  });
});
