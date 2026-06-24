import { Link } from "wouter";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  YAxis,
} from "recharts";
import { TrendingUp, Activity } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatWeight } from "@/lib/format";
import type { RecompSummary, RecompSite } from "@workspace/api-client-react";

// A per-site mini trend. Extracted (with RecompHero) out of dashboard.tsx in
// the Phase 4 hub rebuild so the body-recomposition hero is a reusable tile on
// both the empty-plan state and the Dashboard body section. Behaviour is
// unchanged from the original inline version.
function SiteSparkline({
  series,
  testId,
}: {
  series: RecompSite["series"];
  testId: string;
}) {
  const data = series.length > 0 ? series : [{ date: "", value: 0 }];
  return (
    <div className="h-8 w-full" data-testid={testId}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
          <YAxis hide domain={["dataMin - 0.5", "dataMax + 0.5"]} />
          <Line
            type="monotone"
            dataKey="value"
            stroke="hsl(var(--chart-1))"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// The body-recomposition hero: leads with INCHES LOST (the single most
// important accent number), a per-site sparkline row, a muscle/strength proxy
// block, and a combined on-track verdict. Weight is a small secondary line.
// Empty + single-measurement safe.
export function RecompHero({
  recomp,
  weightGoal,
}: {
  recomp: RecompSummary;
  weightGoal: number | null;
}) {
  const hasData = recomp.measurementCount > 0;

  // Empty state: invite the first check-in instead of rendering NaNs.
  if (!hasData) {
    return (
      <Card
        className="border-primary/20 bg-primary/5 border-l-[6px] border-l-primary shadow-tile"
        data-testid="recomp-hero-empty"
      >
        <CardContent className="p-6 md:p-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Body recomposition
            </p>
            <div className="text-3xl font-display font-extrabold mt-1 tracking-tight">
              Lose inches, gain muscle
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Log your first measurement to start tracking inches lost and
              muscle gained.
            </p>
          </div>
          <Link href="/measurements">
            <Button data-testid="recomp-hero-empty-cta">Log measurement</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  const siteByKey = (k: RecompSite["key"]) =>
    recomp.sites.find((s) => s.key === k);
  const heroSites = (["belly", "chest", "arms", "legs"] as const)
    .map((k) => siteByKey(k))
    .filter((s): s is RecompSite => s != null);

  const strengthPct =
    recomp.strengthScoreCurrent != null && recomp.strengthScoreGoal
      ? Math.min(
          100,
          (recomp.strengthScoreCurrent / recomp.strengthScoreGoal) * 100,
        )
      : null;

  return (
    <Card
      className="border-primary/20 bg-primary/5 border-l-[6px] border-l-primary shadow-tile"
      data-testid="recomp-hero"
    >
      <CardContent className="p-6 md:p-8 space-y-6">
        {/* Headline: inches lost — the single biggest accent number. */}
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Inches lost
            </p>
            <div
              className="text-6xl md:text-7xl font-display font-extrabold mt-2 text-primary tabular-nums leading-none"
              data-testid="recomp-hero-inches-lost"
            >
              {recomp.totalInchesLost.toFixed(1)}
              <span className="text-3xl text-muted-foreground ml-2 font-bold align-baseline">
                in
              </span>
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              Across belly, chest, arms and legs
            </p>
          </div>
          {/* Combined recomp verdict — muted positive when on track. */}
          {recomp.onTrack ? (
            <div
              className="flex items-center gap-2 text-success font-semibold bg-success/10 px-4 py-2 rounded-full self-start"
              data-testid="recomp-hero-verdict-on-track"
            >
              <TrendingUp className="h-5 w-5" />
              On track
            </div>
          ) : (
            <div
              className="flex items-center gap-2 text-muted-foreground font-semibold bg-muted/40 px-4 py-2 rounded-full self-start"
              data-testid="recomp-hero-verdict-neutral"
            >
              <Activity className="h-5 w-5" />
              Building data
            </div>
          )}
        </div>

        {/* Per-site sparkline row */}
        <div
          className="grid grid-cols-2 md:grid-cols-4 gap-4"
          data-testid="recomp-hero-sites"
        >
          {heroSites.map((s) => {
            const grew = s.delta != null && s.delta < 0;
            const shrank = s.delta != null && s.delta > 0;
            const magnitude = s.delta == null ? null : Math.abs(s.delta);
            const good = s.muscleProxy ? grew : shrank;
            return (
              <div
                key={s.key}
                className="space-y-1"
                data-testid={`recomp-hero-site-${s.key}`}
              >
                <div className="flex items-baseline justify-between gap-1">
                  <span className="text-xs font-semibold tracking-wide text-muted-foreground">
                    {s.label}
                  </span>
                  {magnitude != null && magnitude > 0 ? (
                    <span
                      className={`text-xs font-semibold tabular-nums ${good ? "text-success" : "text-muted-foreground"}`}
                    >
                      {s.muscleProxy
                        ? `${grew ? "+" : "-"}${magnitude.toFixed(1)}"`
                        : `-${magnitude.toFixed(1)}"`}
                    </span>
                  ) : (
                    <span className="text-xs tabular-nums text-muted-foreground">
                      —
                    </span>
                  )}
                </div>
                <SiteSparkline
                  series={s.series}
                  testId={`recomp-hero-spark-${s.key}`}
                />
              </div>
            );
          })}
        </div>

        {/* Muscle / strength proxy block + secondary weight */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-border pt-4">
          <div data-testid="recomp-hero-muscle">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Muscle (proxies for lean mass)
            </p>
            <div className="mt-2 space-y-3">
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-muted-foreground">
                  Arm + leg growth
                </span>
                <span className="text-base font-semibold text-foreground tabular-nums">
                  +{recomp.muscleProxyInchesGained.toFixed(1)} in
                </span>
              </div>
              {recomp.strengthScoreCurrent != null &&
              recomp.strengthScoreGoal != null ? (
                <div className="space-y-1.5">
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm text-muted-foreground">
                      Tonal strength score
                    </span>
                    <span className="font-display font-extrabold tabular-nums text-xl">
                      {recomp.strengthScoreCurrent}
                      <span className="text-muted-foreground text-base font-bold">
                        {" "}
                        / {recomp.strengthScoreGoal}
                      </span>
                    </span>
                  </div>
                  {strengthPct != null && (
                    <Progress value={strengthPct} className="h-2.5" />
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Set a Tonal strength score on Goals to track it here.
                </p>
              )}
            </div>
          </div>

          {/* Weight rides secondary now */}
          <div
            className="md:text-right md:border-l md:border-border md:pl-4"
            data-testid="recomp-hero-weight"
          >
            <p className="text-xs font-semibold tracking-wide text-muted-foreground">
              Weight (secondary)
            </p>
            <div className="text-2xl font-display font-extrabold mt-1 tabular-nums">
              {formatWeight(recomp.weightLatest)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {recomp.weightBaseline != null && recomp.weightLatest != null ? (
                <>
                  Start {recomp.weightBaseline.toFixed(1)}
                  {" · "}
                </>
              ) : null}
              Goal {weightGoal != null ? weightGoal.toFixed(0) : "—"}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
