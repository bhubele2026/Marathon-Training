import { motion, useReducedMotion } from "framer-motion";
import { Bar, BarChart, Cell, LabelList, XAxis } from "recharts";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import type { NutritionInsight } from "./types";
import { InsightTile, type PillSpec } from "./insight-tile";
import { buildWeek, WeekStructure, type WeekCell } from "./week-structure";

// The two alcohol scorecard tiles, built around the owner's plan week (Mon–Thu
// dry, Fri–Sun free). The DRY-DAYS tile stays win-not-shame: dry days are wins
// that count UP (azure/success). The ALCOHOL tile is a compact tile that — by
// the owner's explicit choice — uses alarm framing: over the weekly
// drinking-days budget reads RED, at budget amber, under budget green. All
// colour from tokens → light + dark; every motion respects reduced motion.
// Presentation only — both tiles draw from the one server read on
// `insight.alcohol`.

const TRACK = "color-mix(in oklab, var(--muted-foreground) 20%, var(--card))";

// --- Dry days tile (the streak win) ----------------------------------------

// One Mon–Thu target cell fills in the win colour when its day is dry; an open
// target day is an empty azure ring "waiting to be filled"; a target day that
// had drinks gets a soft amber dot (gentle, never red). Free (weekend) days are
// quiet — a faint tint, with a soft success hint if they happened to be dry.
function DryCell({ cell, animate }: { cell: WeekCell; animate: boolean }) {
  const decided = cell.state !== "upcoming";
  if (!cell.isTarget) {
    const tone =
      cell.isDry && decided
        ? "color-mix(in oklab, var(--success) 38%, var(--card))"
        : "color-mix(in oklab, var(--muted-foreground) 20%, var(--card))";
    return <span className="h-2 w-2 rounded-full" style={{ background: tone }} aria-hidden="true" />;
  }
  if (cell.isDry && decided) {
    return (
      <motion.span
        className="h-5 w-5 rounded-full"
        style={{ background: "hsl(var(--success))" }}
        initial={animate ? { scale: 0 } : { scale: 1 }}
        animate={{ scale: 1 }}
        transition={animate ? { duration: 0.32, delay: cell.index * 0.05, ease: "easeOut" } : { duration: 0 }}
        aria-hidden="true"
      />
    );
  }
  if (cell.drinks > 0) {
    return (
      <span
        className="h-5 w-5 rounded-full border"
        style={{
          background: "color-mix(in oklab, var(--warning) 26%, var(--card))",
          borderColor: "color-mix(in oklab, var(--warning) 50%, var(--card))",
        }}
        aria-hidden="true"
      />
    );
  }
  return (
    <span
      className="h-5 w-5 rounded-full border-2"
      style={{ borderColor: "color-mix(in oklab, var(--primary) 45%, var(--card))" }}
      aria-hidden="true"
    />
  );
}

export function DryDaysTile({ insight }: { insight: NutritionInsight }) {
  const a = insight.alcohol;
  const reduced = useReducedMotion();
  if (!a) return null;
  const animate = !reduced;
  const week = buildWeek(a.dailyStrip);
  const hit = a.dryDaysThisWeek >= a.dryDaysTarget;
  const showTrend = !a.seedState && a.weeksTracked >= 2;

  const pill: PillSpec = a.seedState
    ? { tone: "neutral", label: "early read" }
    : hit
      ? { tone: "success", label: "week complete" }
      : { tone: "info", label: `${a.dryDaysThisWeek} of ${a.dryDaysTarget} dry` };

  const drawer = (
    <div className="space-y-3">
      <ul className="space-y-1.5">
        {a.weeklyTrend.map((w) => (
          <li key={w.weekStart} className="flex items-center justify-between text-[12.5px]">
            <span className="text-muted-foreground">
              Week of {w.weekStart.slice(5)}
              {w.inProgress && <span className="ml-1 text-[10px] uppercase">· now</span>}
            </span>
            <span className="flex items-center gap-1.5 tabular-nums font-semibold text-foreground">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: w.hitTarget ? "hsl(var(--success))" : TRACK }}
                aria-hidden="true"
              />
              {w.dryDays} dry
            </span>
          </li>
        ))}
      </ul>
      {insight.detail && (
        <p className="text-[13px] leading-relaxed text-muted-foreground">{insight.detail}</p>
      )}
    </div>
  );

  return (
    <InsightTile
      name={insight.label}
      status={insight.status}
      pill={pill}
      caption={insight.caption}
      whyLabel="Why + week by week"
      drawer={drawer}
    >
      <div className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          {/* Streak is the star — soft success glow + gentle pulse when on plan. */}
          <motion.div
            className="rounded-xl px-2 py-1"
            style={{
              background: hit ? "color-mix(in oklab, var(--success) 12%, var(--card))" : "transparent",
            }}
            animate={hit && animate ? { boxShadow: ["0 0 0 0 hsl(var(--success)/0)", "0 0 14px 2px hsl(var(--success)/0.25)", "0 0 0 0 hsl(var(--success)/0)"] } : undefined}
            transition={hit && animate ? { duration: 2.4, repeat: Infinity, ease: "easeInOut" } : undefined}
          >
            <div className="flex items-baseline gap-1.5">
              <span className="font-display text-[30px] font-extrabold leading-none tabular-nums text-foreground">
                {a.currentDryStreak}
              </span>
              <span className="text-[12px] font-semibold text-muted-foreground">day dry streak</span>
            </div>
          </motion.div>
          <div className="shrink-0 text-right">
            <div className="font-display text-[18px] font-bold leading-none tabular-nums">
              <span style={{ color: hit ? "hsl(var(--success))" : "hsl(var(--foreground))" }}>
                {a.dryDaysThisWeek}
              </span>
              <span className="text-muted-foreground">/{a.dryDaysTarget}</span>
            </div>
            <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              dry this week
            </div>
          </div>
        </div>

        <WeekStructure
          week={week}
          renderCell={(c) => <DryCell cell={c} animate={animate} />}
          testId="dry-week-structure"
        />

        {showTrend ? (
          <p className="text-[11.5px] tabular-nums text-muted-foreground">
            {a.weeksOnTarget} of last {a.weeksTracked} · avg {a.avgDryPerWeek ?? "—"} dry/wk
            {a.weeksOnTargetStreak > 0 ? ` · ${a.weeksOnTargetStreak}-wk streak` : ""}
          </p>
        ) : (
          <p className="text-[11.5px] text-muted-foreground">
            {a.dryDaysThisWeek === 0
              ? "Four dry slots this week — fill one."
              : "Trend builds as the weeks complete."}
          </p>
        )}
      </div>
    </InsightTile>
  );
}

// --- Alcohol tile (compact: hero count + labeled bars + days-budget gauge) ---

// Bar colour. The owner opted OUT of no-shame for this card, so over-budget reads
// in alarm colours: a drink on a Mon–Thu dry-target day is RED (it was meant to
// be a dry night), a heavy weekend (≥4) is amber, a light weekend drink is a calm
// neutral bar, and a zero day is a faint baseline tick (never an empty hole).
function barColor(cell: WeekCell): string {
  if (cell.drinks <= 0) return TRACK;
  if (cell.isTarget) return "hsl(var(--destructive))";
  if (cell.drinks >= 4) return "hsl(var(--warning))";
  return "color-mix(in oklab, var(--muted-foreground) 55%, var(--card))";
}

const ALC_CONFIG = {
  drinks: { label: "Drinks", color: "hsl(var(--muted-foreground))" },
} satisfies ChartConfig;

// Weekday labels under the strip, target days fuller than free days.
function WeekTick(props: { x?: number; y?: number; index?: number; payload?: { value?: string } }) {
  const isTarget = (props.index ?? 0) < 4;
  return (
    <text
      x={props.x}
      y={(props.y ?? 0) + 10}
      textAnchor="middle"
      style={{
        fontSize: 10,
        fontWeight: 600,
        fill: isTarget
          ? "hsl(var(--muted-foreground))"
          : "color-mix(in oklab, var(--muted-foreground) 45%, var(--card))",
      }}
    >
      {props.payload?.value}
    </text>
  );
}

// On-bar value label — the drink count, hidden on zero days.
function BarValue(props: { x?: number; y?: number; width?: number; value?: number }) {
  const v = props.value ?? 0;
  if (v <= 0) return null;
  return (
    <text
      x={(props.x ?? 0) + (props.width ?? 0) / 2}
      y={(props.y ?? 0) - 4}
      textAnchor="middle"
      style={{ fontSize: 10, fontWeight: 700, fill: "hsl(var(--foreground))" }}
    >
      {v}
    </text>
  );
}

function WeekBars({ week, animate }: { week: WeekCell[]; animate: boolean }) {
  const data = week.map((c) => ({ label: c.label, drinks: c.drinks }));
  return (
    <ChartContainer
      config={ALC_CONFIG}
      className="aspect-auto w-full"
      style={{ height: 104 }}
      data-testid="alcohol-bar-strip"
    >
      <BarChart data={data} margin={{ top: 16, right: 6, bottom: 0, left: 6 }} barCategoryGap="22%">
        <XAxis
          dataKey="label"
          interval={0}
          tickLine={false}
          axisLine={{ stroke: "hsl(var(--border))" }}
          tickMargin={4}
          tick={<WeekTick />}
        />
        <Bar dataKey="drinks" radius={[3, 3, 0, 0]} minPointSize={2} isAnimationActive={animate}>
          <LabelList dataKey="drinks" content={<BarValue />} />
          {week.map((c) => (
            <Cell key={c.index} fill={barColor(c)} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

// Drinking days vs the weekly budget — segments fill green up to the budget, then
// RED for any day over it. Doubles as the "free days used" visual + over-budget
// gauge (the engine's budget is days, not a drink count).
function DaysBudget({ used, budget }: { used: number; budget: number }) {
  const total = Math.max(budget, used, 1);
  const over = used > budget;
  return (
    <div>
      <div className="flex flex-wrap gap-1" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => {
          const filled = i < used;
          const beyond = i >= budget;
          const bg = !filled
            ? "color-mix(in oklab, var(--muted-foreground) 18%, var(--card))"
            : beyond
              ? "hsl(var(--destructive))"
              : "hsl(var(--success))";
          return <span key={i} className="h-2.5 w-5 rounded-[3px]" style={{ background: bg }} />;
        })}
      </div>
      <p className="mt-1.5 text-[11px] font-medium tabular-nums text-muted-foreground">
        <span
          className="font-bold"
          style={{ color: over ? "hsl(var(--destructive))" : "hsl(var(--foreground))" }}
        >
          {used}
        </span>{" "}
        of {budget} drinking days
      </p>
    </div>
  );
}

// Paired comparison bars for one impact metric — drinking days vs dry days
// (e.g. next-day training load), so the cost is visible, not just stated.
// Coral = drinking, green = dry; both scaled to the larger of the two.
function ImpactBars({
  drinking,
  dry,
}: {
  drinking: number;
  dry: number;
}) {
  const max = Math.max(drinking, dry, 1);
  const rows: Array<{ caption: string; value: number; color: string }> = [
    { caption: "Drinking days", value: drinking, color: "hsl(var(--chart-2))" },
    { caption: "Dry days", value: dry, color: "hsl(var(--success))" },
  ];
  return (
    <div className="mt-1.5 space-y-1">
      {rows.map((r) => (
        <div key={r.caption} className="flex items-center gap-2">
          <span className="w-[68px] shrink-0 text-[11px] text-muted-foreground">{r.caption}</span>
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.round((Math.max(0, r.value) / max) * 100)}%`, background: r.color }}
            />
          </div>
          <span className="w-9 shrink-0 text-right text-[11.5px] font-semibold tabular-nums text-foreground">
            {r.value}
          </span>
        </div>
      ))}
    </div>
  );
}

export function AlcoholTile({ insight }: { insight: NutritionInsight }) {
  const a = insight.alcohol;
  const reduced = useReducedMotion();
  if (!a) return null;
  const animate = !reduced;
  const week = buildWeek(a.dailyStrip);
  const overBudget = a.drinkingDaysThisWeek > a.drinkingBudget;
  const atBudget = a.drinkingDaysThisWeek === a.drinkingBudget;

  // Owner opted into the alarm framing for THIS card: over budget reads RED,
  // at budget amber, under budget green; early read stays neutral. (The dry-days
  // card keeps the win-not-shame treatment.)
  const pill: PillSpec = a.seedState
    ? { tone: "neutral", label: "early read" }
    : overBudget
      ? { tone: "destructive", label: "over budget" }
      : atBudget
        ? { tone: "warning", label: "at budget" }
        : { tone: "success", label: "on plan" };

  const drawer = (
    <div className="space-y-3">
      {a.impact.length > 0 ? (
        <ul className="space-y-2">
          {a.impact.map((im) => (
            <li key={im.key} className="text-[12.5px]">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-foreground">{im.label}</span>
                {im.deltaPct != null && (
                  <span
                    className="shrink-0 tabular-nums font-semibold"
                    style={{
                      color:
                        im.deltaPct < 0 === im.betterWhenDry
                          ? "hsl(var(--success))"
                          : "hsl(var(--warning))",
                    }}
                  >
                    {im.deltaPct > 0 ? "+" : ""}
                    {im.deltaPct}% {im.betterWhenDry ? "when dry" : ""}
                  </span>
                )}
              </div>
              {im.drinkingAvg != null && im.dryAvg != null && (
                <ImpactBars drinking={im.drinkingAvg} dry={im.dryAvg} />
              )}
              <p className="mt-1 leading-relaxed text-muted-foreground">{im.note}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          {insight.detail ??
            "Keep logging — once there's about two weeks I can compare your drinking days to your dry days (next-day training, protein, calories, hydration)."}
        </p>
      )}
    </div>
  );

  return (
    <InsightTile
      name={insight.label}
      status={insight.status}
      pill={pill}
      caption={insight.caption}
      whyLabel="Why + impact"
      drawer={drawer}
    >
      {/* Compact tile: hero count, the 7-day bars, then the days-budget gauge. */}
      <div className="space-y-2.5">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[28px] font-extrabold leading-none tabular-nums text-foreground">
            {a.weekDrinks}
          </span>
          <span className="text-[12px] font-semibold text-muted-foreground">
            {a.weekDrinks === 1 ? "drink" : "drinks"} this week
          </span>
        </div>
        <WeekBars week={week} animate={animate} />
        <DaysBudget used={a.drinkingDaysThisWeek} budget={a.drinkingBudget} />
      </div>
    </InsightTile>
  );
}

// Shared guard so a stray alcohol insight without its payload renders nothing.
export function isAlcoholInsight(ins: NutritionInsight): boolean {
  return (ins.id === "alcohol" || ins.id === "dryDays") && !!ins.alcohol;
}
