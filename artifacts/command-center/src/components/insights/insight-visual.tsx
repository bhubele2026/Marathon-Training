import { StatReadout } from "@/components/studio/stat-readout";
import { BulletMetric } from "./bullet-metric";
import { TrendVsGoal } from "./trend-vs-goal";
import { RecompTrajectory } from "./recomp-trajectory";
import { AdherenceDots } from "./adherence-dots";
import { type NutritionInsight, statusTone } from "./types";

// Maps an insight to its visual, shared by the Nutrition-page panel and the
// Dashboard insight band so the two never disagree. Body composition gets the
// recomp trajectory + four stat tiles; every other read gets the bullet
// (is-vs-should) + a streak of adherence dots + a trend sparkline when there's
// a logged window.

export function InsightVisual({ insight: ins }: { insight: NutritionInsight }) {
  if (ins.id === "bodycomp") {
    return (
      <div className="space-y-4">
        <RecompTrajectory
          trajectory={ins.bodyTrajectory}
          expectedBand={ins.expectedBand}
          tone={statusTone(ins.status)}
        />
        {ins.bodyStats && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
            {ins.bodyStats.map((s) => {
              const good =
                s.change == null || s.change === 0 || s.goodDirection === "either"
                  ? "neutral"
                  : (s.goodDirection === "down" ? s.change < 0 : s.change > 0)
                    ? "success"
                    : "neutral";
              return (
                <StatReadout
                  key={s.key}
                  label={s.label}
                  value={s.value != null ? s.value : "—"}
                  unit={s.value != null ? s.unit : undefined}
                  delta={
                    s.change != null && s.change !== 0
                      ? { value: `${s.change > 0 ? "+" : ""}${s.change}`, tone: good as "success" | "neutral" }
                      : undefined
                  }
                />
              );
            })}
          </div>
        )}
      </div>
    );
  }

  const hasWindow = (ins.series?.length ?? 0) >= 2;
  const hasDays = (ins.perDay ?? []).some((d) => d.hit !== "none");
  return (
    <div className="space-y-3">
      <BulletMetric insight={ins} />
      {hasDays && (
        <div className="flex items-center justify-between gap-3">
          <AdherenceDots perDay={ins.perDay} />
          {ins.daysHit != null && ins.daysLogged ? (
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              on target {ins.daysHit}/{ins.daysLogged}
            </span>
          ) : null}
        </div>
      )}
      {hasWindow && (
        <TrendVsGoal
          series={ins.series}
          goal={ins.goal}
          unit={ins.unit}
          tone={statusTone(ins.status)}
        />
      )}
    </div>
  );
}
