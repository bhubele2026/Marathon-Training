import type { ReactNode } from "react";
import {
  type NutritionInsight,
  type NutritionistReport,
  type InsightStatus,
  statusGaugeColor,
} from "./types";
import { InsightTile, type PillSpec } from "./insight-tile";
import { RadialGauge } from "./radial-gauge";
import { BandBar } from "./band-bar";
import { DropletGauge } from "./droplet-gauge";
import { DialGauge } from "./dial-gauge";
import { DonutStat } from "./donut-stat";
import { StreakDots } from "./streak-dots";
import { RecompHero } from "./recomp-hero";
import { TrendVsGoal } from "./trend-vs-goal";
import { RecompTrajectory } from "./recomp-trajectory";
import { AlcoholTile, DryDaysTile } from "./alcohol-tiles";

// The compact, varied insights scorecard (mockup parity): a hero body-comp tile
// + a grid of right-sized per-metric tiles, the 8-week trend chart and the long
// reasoning tucked behind each tile's "Why" drawer. Engine owns every number;
// the AI owns the caption + detail.

const fmt = (n: number) => Math.round(n).toLocaleString();
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const ratio = (ins: NutritionInsight) =>
  ins.actual != null && ins.target ? clamp01(ins.actual / ins.target) : 0;

// The Why drawer for a standard metric tile: the 8-week trend + the long prose.
function MetricDrawer({ insight }: { insight: NutritionInsight }) {
  const hasWindow = (insight.series?.length ?? 0) >= 2;
  return (
    <div className="space-y-3">
      {hasWindow && (
        <TrendVsGoal
          series={insight.series}
          goal={insight.goal}
          unit={insight.unit}
          tone={statusGaugeColor(insight.status) === "hsl(var(--success))" ? "success" : "warning"}
        />
      )}
      {insight.detail && (
        <p className="text-[13px] leading-relaxed text-muted-foreground">{insight.detail}</p>
      )}
    </div>
  );
}

// The little meta column beside a ring (sub-line + adherence streak).
function RingMeta({ insight }: { insight: NutritionInsight }) {
  return (
    <div className="min-w-0">
      {insight.subMetric && (
        <div className="font-mono text-[15px] font-bold text-foreground">{insight.subMetric}</div>
      )}
      <StreakDots
        perDay={insight.perDay}
        daysHit={insight.daysHit}
        daysLogged={insight.daysLogged}
        tally
        className="mt-2"
      />
    </div>
  );
}

// One scorecard tile, dispatched by insight id to the right viz. Shared by the
// full scorecard and the Dashboard band so they never disagree.
export function ScorecardTile({ insight }: { insight: NutritionInsight }) {
  const whyLabel = (insight.series?.length ?? 0) >= 2 ? "Why + 8-wk chart" : "Why";
  const drawer = <MetricDrawer insight={insight} />;
  const common = { name: insight.label, status: insight.status, caption: insight.caption };

  // Alcohol reads — the two fun, self-contained reduction tiles.
  if (insight.id === "dryDays") return <DryDaysTile insight={insight} />;
  if (insight.id === "alcohol") return <AlcoholTile insight={insight} />;

  // Body composition — the wide hero.
  if (insight.id === "bodycomp") {
    return (
      <InsightTile
        {...common}
        whyLabel="Why + full recomp trend"
        drawer={
          <div className="space-y-3">
            <RecompTrajectory
              trajectory={insight.bodyTrajectory}
              expectedBand={insight.expectedBand}
              tone="success"
            />
            {insight.detail && (
              <p className="text-[13px] leading-relaxed text-muted-foreground">{insight.detail}</p>
            )}
          </div>
        }
      >
        <RecompHero
          bodyFatPct={insight.actual}
          bodyFatSub={insight.subMetric ?? undefined}
          trajectory={insight.bodyTrajectory}
          expectedBand={insight.expectedBand}
          bodyStats={insight.bodyStats}
        />
      </InsightTile>
    );
  }

  // Fuelling — the band bar.
  if (insight.id === "fuelling") {
    return (
      <InsightTile {...common} whyLabel={whyLabel} drawer={drawer}>
        <BandBar
          actual={insight.actual}
          target={insight.target}
          floor={insight.floor}
          ceiling={insight.ceiling}
          status={insight.status}
          unit={insight.unit}
        />
      </InsightTile>
    );
  }

  // Hydration — the droplet.
  if (insight.id === "hydration") {
    return (
      <InsightTile {...common} whyLabel={whyLabel} drawer={drawer}>
        <div className="flex items-center gap-3.5">
          <DropletGauge pct={ratio(insight)} value={insight.actual} />
          <div className="min-w-0">
            <div className="font-mono text-[17px] font-bold text-foreground">
              {insight.actual != null ? fmt(insight.actual) : "—"}
              {insight.target != null && (
                <span className="ml-1 text-[12px] font-semibold text-muted-foreground">/ {fmt(insight.target)} oz</span>
              )}
            </div>
            {insight.subMetric && (
              <div className="mt-1.5 text-[11.5px]" style={{ color: "hsl(var(--chart-5))" }}>
                {insight.subMetric}
              </div>
            )}
          </div>
        </div>
      </InsightTile>
    );
  }

  // Sodium — the half-circle dial.
  if (insight.id === "sodium") {
    const ceiling = insight.ceiling ?? insight.target ?? 2300;
    const floor = insight.floor ?? Math.round(ceiling * 0.65);
    const scale = Math.max(6000, (insight.actual ?? 0) * 1.1, ceiling * 2);
    const pill: PillSpec | undefined =
      insight.status === "over"
        ? { tone: "warning", label: "high", glyph: "▴" }
        : insight.status === "under"
          ? { tone: "warning", label: "low", glyph: "▾" }
          : undefined;
    return (
      <InsightTile {...common} pill={pill} whyLabel={whyLabel} drawer={drawer}>
        <div className="flex items-center gap-3.5">
          <DialGauge
            pct={clamp01((insight.actual ?? 0) / scale)}
            bandLo={floor / scale}
            bandHi={ceiling / scale}
            status={insight.status}
            lowLabel={`${(floor / 1000).toFixed(1)}k`}
            highLabel={`${(ceiling / 1000).toFixed(1)}k+`}
          />
          <div className="min-w-0">
            <div className="font-mono text-[17px] font-bold text-foreground">
              {insight.actual != null ? fmt(insight.actual) : "—"}
              <span className="ml-1 text-[12px] font-semibold text-muted-foreground">mg</span>
            </div>
            {insight.subMetric && (
              <div className="mt-1.5 text-[11.5px] text-muted-foreground">{insight.subMetric}</div>
            )}
          </div>
        </div>
      </InsightTile>
    );
  }

  // Protein / Carbs / Fat — the radial gauges.
  return (
    <InsightTile {...common} whyLabel={whyLabel} drawer={drawer}>
      <div className="flex items-center gap-3.5">
        <RadialGauge
          pct={ratio(insight)}
          color={statusGaugeColor(insight.status)}
          centerMain={insight.actual != null ? fmt(insight.actual) : "—"}
          centerSub={insight.target != null ? `/${fmt(insight.target)} ${insight.unit}` : undefined}
        />
        <RingMeta insight={insight} />
      </div>
    </InsightTile>
  );
}

// The consistency / days-on-target tile — derived from the keystone metric's
// adherence + the window's session count (not a NutritionInsight itself).
function ConsistencyTile({ report }: { report: NutritionistReport }) {
  const keystone =
    report.insights.find((i) => i.id === "protein" && (i.daysLogged ?? 0) > 0) ??
    report.insights.find((i) => (i.daysLogged ?? 0) > 0);
  const hit = keystone?.daysHit ?? 0;
  const logged = keystone?.daysLogged ?? 0;
  const pct = logged > 0 ? hit / logged : 0;
  const status: InsightStatus = logged === 0 ? "early" : pct >= 0.7 ? "on_track" : "attention";
  const weeks = report.weeksElapsed || report.weeks;
  const statText =
    report.sessionsDone != null ? `${report.sessionsDone} sessions / ${weeks} wk` : undefined;
  const pill: PillSpec = {
    tone: "info",
    label: logged > 0 ? `${logged} days logged` : "no logs yet",
  };
  const caption =
    logged === 0
      ? "Log a few days — can't coach a blank page."
      : pct >= 0.7
        ? "Logging's there and the targets are landing. Keep the streak."
        : "The work is there; the logging is the lever. Log to match the training.";
  return (
    <InsightTile name="Consistency" status={status} pill={pill} caption={caption}>
      <DonutStat
        pct={pct}
        statText={statText}
        sub={pct >= 0.7 ? "dialed in — keep it up" : "trained hard — now log to match"}
        perDay={keystone?.perDay}
      />
    </InsightTile>
  );
}

// Fixed layout order matching the mockup (not significance-ranked): the hero,
// then the macro rings, fuelling, hydration, sodium, and consistency.
const ORDER: NutritionInsight["id"][] = [
  "protein",
  "carbs",
  "fat",
  "fuelling",
  "hydration",
  "sodium",
  // Dry days + alcohol are standard tiles in the grid (compact), after the macros.
  "dryDays",
  "alcohol",
];

export function NutritionScorecard({ report }: { report: NutritionistReport }): ReactNode {
  const byId = (id: NutritionInsight["id"]) => report.insights.find((i) => i.id === id);
  const bodycomp = byId("bodycomp");
  return (
    <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:grid-cols-3">
      {bodycomp && (
        <div className="md:col-span-2 lg:col-span-3">
          <ScorecardTile insight={bodycomp} />
        </div>
      )}
      {ORDER.map((id) => {
        const ins = byId(id);
        return ins ? <ScorecardTile key={id} insight={ins} /> : null;
      })}
      <ConsistencyTile report={report} />
    </div>
  );
}
