// Frontend mirror of the server's NutritionInsight model (@workspace/db). The
// nutrition slice is hand-fetched (not in openapi.yaml) and the command-center
// deliberately doesn't depend on the server/db package, so the wire shape is
// declared here once and shared by the panel + the whole insight kit.
//
// Keep in sync with lib/db/src/schema/nutritionistReports.ts. The ENGINE owns
// every numeric field; the AI owns only `caption` + `detail`.

export type InsightId =
  | "protein"
  | "carbs"
  | "fuelling"
  | "hydration"
  | "sodium"
  | "bodycomp";

export type InsightGroup = "macros" | "fuelling" | "hydration" | "sodium" | "body";

export type InsightDirection = "higher_better" | "lower_better" | "band";

export type InsightStatus =
  | "ahead"
  | "on_track"
  | "attention"
  | "under"
  | "over"
  | "appropriate"
  | "early";

export type AdherenceHit = "hit" | "close" | "miss" | "none";

export type InsightSeriesPoint = { date: string; value: number };
export type InsightPerDay = { date: string; hit: AdherenceHit };
export type InsightGoal = number | { lo: number; hi: number };

export type BodyTrajectoryPoint = {
  date: string;
  weightLb: number | null;
  bodyFatPct: number | null;
  leanLb: number | null;
  fatLb: number | null;
};

export type BodyStat = {
  key: "weight" | "bodyfat" | "lean" | "fat";
  label: string;
  unit: string;
  value: number | null;
  change: number | null;
  goodDirection: "down" | "up" | "either";
};

export type NutritionInsight = {
  id: InsightId;
  label: string;
  group: InsightGroup;
  unit: string;
  actual: number | null;
  target: number | null;
  floor?: number | null;
  ceiling?: number | null;
  direction: InsightDirection;
  series?: InsightSeriesPoint[];
  goal?: InsightGoal | null;
  daysLogged?: number | null;
  daysHit?: number | null;
  perDay?: InsightPerDay[];
  status: InsightStatus;
  bodyTrajectory?: BodyTrajectoryPoint[];
  bodyStats?: BodyStat[];
  expectedBand?: { lo: number; hi: number } | null;
  caption: string;
  detail?: string;
};

export type NutritionistReport = {
  weeks: number;
  weeksElapsed: number;
  headline: string;
  insights: NutritionInsight[];
  today: string;
  keyMoves: string[];
  confidence: "low" | "medium" | "high";
  dataGaps: string[];
  narrative: string;
  generatedAt?: string;
  cached?: boolean;
};

// Map an insight status to a semantic color token used across the kit.
//   ahead | on_track | appropriate → success
//   attention | early             → warning
//   under | over                  → destructive
export type SemanticTone = "success" | "warning" | "destructive";

export function statusTone(s: InsightStatus): SemanticTone {
  switch (s) {
    case "ahead":
    case "on_track":
    case "appropriate":
      return "success";
    case "under":
    case "over":
      return "destructive";
    default:
      return "warning";
  }
}

// The CSS hsl(var(--token)) color for a semantic tone.
export function toneColor(tone: SemanticTone): string {
  return `hsl(var(--${tone}))`;
}

// --- Scorecard status pills + gauge colors (mockup parity, token-driven) -----

// The pill palette: status reads + two informational tones (info=azure for
// consistency/neutral context, neutral=grey for "too early").
export type PillTone = "success" | "warning" | "destructive" | "info" | "neutral";

export function statusToPillTone(s: InsightStatus): PillTone {
  switch (s) {
    case "ahead":
    case "on_track":
    case "appropriate":
      return "success";
    case "attention":
      return "warning";
    case "under":
    case "over":
      return "destructive";
    default:
      return "neutral"; // early
  }
}

// Every pill/gauge color resolves from a theme token, so the scorecard flips
// correctly with the theme. info → azure (--chart-1), neutral → muted ink.
export function pillToneColor(tone: PillTone): string {
  switch (tone) {
    case "success":
      return "hsl(var(--success))";
    case "warning":
      return "hsl(var(--warning))";
    case "destructive":
      return "hsl(var(--destructive))";
    case "info":
      return "hsl(var(--chart-1))";
    case "neutral":
      return "hsl(var(--muted-foreground))";
  }
}

// A short uppercase pill label + leading glyph for a status (mockup tone).
export function defaultPillLabel(s: InsightStatus): { glyph: string; label: string } {
  switch (s) {
    case "ahead":
      return { glyph: "▴", label: "ahead" };
    case "on_track":
      return { glyph: "✓", label: "on track" };
    case "appropriate":
      return { glyph: "✓", label: "appropriate" };
    case "attention":
      return { glyph: "▴", label: "watch" };
    case "under":
      return { glyph: "▾", label: "under" };
    case "over":
      return { glyph: "▴", label: "over" };
    default:
      return { glyph: "⏳", label: "too early" };
  }
}

// The gauge fill color for a STATUS (rings/needles): the status tone's token.
// Identity-coloured gauges (hydration droplet = --chart-5, consistency donut =
// --chart-1) pass their own color instead.
export function statusGaugeColor(s: InsightStatus): string {
  return pillToneColor(statusToPillTone(s));
}

// The unfilled gauge/dial track. Mixed off the muted ink so it stays visible on
// a WHITE card and on dark — a raw --muted (95% L in light) would vanish.
export const GAUGE_TRACK = "color-mix(in oklab, var(--muted-foreground) 22%, var(--card))";

// A status-tinted surface that reads on both themes (e.g. pill / band fills).
export function tonedSurface(tone: PillTone, pct = 12): string {
  return `color-mix(in oklab, ${pillToneColor(tone)} ${pct}%, var(--card))`;
}
