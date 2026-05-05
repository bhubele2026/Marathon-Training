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
      hrZoneModel: "five_zone_max",
    },
    isLoading: false,
  }),
  useGetSuggestedRestingHr: () => ({
    data: { value: null, sampleCount: 0, windowDays: 90 },
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
  UserPreferencesHrZoneModel: {
    five_zone_max: "five_zone_max",
    friel_7_zone: "friel_7_zone",
    coggan_5_zone: "coggan_5_zone",
    polarized_3_zone: "polarized_3_zone",
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { HR_ZONE_COLORS } from "@/lib/run-target";
import { VisualThemeProvider } from "@/lib/visual-theme";
import Settings from "./settings";

function renderSettings() {
  return render(
    <VisualThemeProvider>
      <Settings />
    </VisualThemeProvider>,
  );
}

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
    renderSettings();

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
      renderSettings();

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
    renderSettings();

    for (const bucket of [1, 2, 3, 4, 5] as const) {
      expect(
        screen.queryByTestId(`zone-preview-swatch-${bucket}`),
      ).toBeNull();
    }
  });
});

// Task #171: lock the full HR zone color ramp on the Settings preview
// chips. The bucket-loop test above only proves a swatch *exists* on
// every row in hr_zones mode — it never asserts that bucket N actually
// renders the HR_ZONE_COLORS[N] token. A regression that wired the
// wrong bucket to the wrong swatch on a Recovery / Steady / Tempo /
// Interval row (e.g. swapped Zone 3 amber and Zone 5 red) would still
// slip through. This parametrized suite re-renders Settings once per
// bucket, asserts the row's "Zone N" prefix is present so the swatch
// we grab is unambiguously for that bucket, and pulls the expected
// swatch class directly from HR_ZONE_COLORS so the assertion follows
// any future re-mapping of buckets → tokens without a test edit.
describe("Settings — every HR zone bucket renders the matching preview swatch (task #171)", () => {
  const buckets = [1, 2, 3, 4, 5] as const;

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    runTargetingModeRef.current = "effort";
    maxHrRef.current = 200;
  });

  it.each(buckets.map((bucket) => ({ bucket })))(
    "Zone $bucket preview row paints the matching HR_ZONE_COLORS swatch in hr_zones mode",
    ({ bucket }) => {
      runTargetingModeRef.current = "hr_zones";
      maxHrRef.current = 200;
      renderSettings();

      // Grab the row first so the "Zone N" prefix and the swatch we
      // assert on are unambiguously the ones for this bucket — not
      // some other row's swatch that happened to render with a
      // matching class.
      const row = screen.getByTestId(`zone-preview-row-${bucket}`);
      expect(row.textContent).toContain(`Zone ${bucket}`);

      const swatch = screen.getByTestId(`zone-preview-swatch-${bucket}`);
      // Pulled from HR_ZONE_COLORS so the assertion follows any future
      // re-mapping of buckets → tokens without needing a test edit.
      const expectedSwatchClass = HR_ZONE_COLORS[bucket].swatchClass;
      expect(swatch.className).toContain(expectedSwatchClass);
      expect(swatch.getAttribute("aria-hidden")).toBe("true");
    },
  );
});
