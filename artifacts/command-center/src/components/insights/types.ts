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
