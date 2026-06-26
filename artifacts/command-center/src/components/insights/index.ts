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
