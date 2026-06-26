// The visual-first insight kit: glanceable "how it should be going vs how it's
// going" charts that read a NutritionInsight. The engine owns every number; the
// AI owns only the caption/detail words.

export * from "./types";
export { BulletMetric, type BulletMetricProps } from "./bullet-metric";
export { TrendVsGoal } from "./trend-vs-goal";
export { RecompTrajectory } from "./recomp-trajectory";
export { TargetGauge, type TargetGaugeProps } from "./target-gauge";
export { AdherenceDots, type AdherenceDotsProps } from "./adherence-dots";
export { InsightCard, StatusPill, type InsightCardProps } from "./insight-card";
export { InsightVisual } from "./insight-visual";

// --- Scorecard primitives (the compact, varied per-metric viz) ---------------
export { InsightTile, type InsightTileProps, type PillSpec } from "./insight-tile";
export { RadialGauge, type RadialGaugeProps } from "./radial-gauge";
export { StreakDots, type StreakDotsProps } from "./streak-dots";
export { BandBar } from "./band-bar";
export { DropletGauge } from "./droplet-gauge";
export { DialGauge } from "./dial-gauge";
export { DonutStat } from "./donut-stat";
export { RecompHero } from "./recomp-hero";
export { NutritionScorecard, ScorecardTile } from "./nutrition-scorecard";
export { AlcoholTile, DryDaysTile, isAlcoholInsight } from "./alcohol-tiles";
