import { motion, useReducedMotion } from "framer-motion";
import { Bar, BarChart, Cell, XAxis } from "recharts";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import type { NutritionInsight } from "./types";
import { InsightTile, type PillSpec } from "./insight-tile";
import { buildWeek, WeekStructure, type WeekCell } from "./week-structure";

// The two alcohol scorecard tiles, built around the owner's plan week (Mon–Thu
// dry, Fri–Sun free). Reduction tool, so the read is win-not-shame: dry days are
// wins that count UP (azure/success); drinking within plan reads neutral;
// over-plan is a soft amber nudge. NEVER red, never an X. All colour from tokens
// → light + dark; every motion respects reduced motion. Presentation only —
// both tiles draw from the one server read on `insight.alcohol`.

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

// --- Alcohol tile (a real 7-day strip; what it costs; never red) ------------

// Bar colour, no-shame: zero days are a faint baseline tick (never empty), free
// (weekend) drinks are a calm neutral bar, target-day (Mon–Thu) drinks are a
// soft amber nudge.
function barColor(cell: WeekCell): string {
  if (cell.drinks <= 0) return TRACK;
  if (cell.isTarget) return "hsl(var(--warning))";
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

function WeekBars({ week, animate }: { week: WeekCell[]; animate: boolean }) {
  const data = week.map((c) => ({ label: c.label, drinks: c.drinks }));
  return (
    <ChartContainer
      config={ALC_CONFIG}
      className="aspect-auto w-full"
      style={{ height: 92 }}
      data-testid="alcohol-bar-strip"
    >
      <BarChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 4 }} barCategoryGap="20%">
        <XAxis
          dataKey="label"
          interval={0}
          tickLine={false}
          axisLine={{ stroke: "hsl(var(--border))" }}
          tickMargin={4}
          tick={<WeekTick />}
        />
        <Bar dataKey="drinks" radius={[3, 3, 0, 0]} minPointSize={2} isAnimationActive={animate}>
          {week.map((c) => (
            <Cell key={c.index} fill={barColor(c)} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

export function AlcoholTile({ insight }: { insight: NutritionInsight }) {
  const a = insight.alcohol;
  const reduced = useReducedMotion();
  if (!a) return null;
  const animate = !reduced;
  const week = buildWeek(a.dailyStrip);
  const overPlan = a.drinkingDaysThisWeek > a.drinkingBudget;

  // Forced non-status pill so within-plan reads NEUTRAL (not a green win),
  // over-plan a soft amber nudge — never the red destructive treatment.
  const pill: PillSpec = a.seedState
    ? { tone: "neutral", label: "early read" }
    : overPlan
      ? { tone: "warning", label: "over plan" }
      : { tone: "neutral", label: "on plan" };

  const drawer = (
    <div className="space-y-3">
      {a.impact.length > 0 ? (
        <ul className="space-y-2">
          {a.impact.map((im) => (
            <li key={im.key} className="text-[12.5px]">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-foreground">{im.label}</span>
                {im.drinkingAvg != null && im.dryAvg != null && (
                  <span className="tabular-nums text-muted-foreground">
                    <span>{im.drinkingAvg}</span>
                    {" vs "}
                    <span style={{ color: "hsl(var(--success))" }}>{im.dryAvg}</span>
                    {im.deltaPct != null && (
                      <span
                        className="ml-1"
                        style={{
                          color:
                            im.deltaPct < 0 === im.betterWhenDry
                              ? "hsl(var(--success))"
                              : "hsl(var(--warning))",
                        }}
                      >
                        ({im.deltaPct > 0 ? "+" : ""}
                        {im.deltaPct}%)
                      </span>
                    )}
                  </span>
                )}
              </div>
              <p className="mt-0.5 leading-relaxed text-muted-foreground">{im.note}</p>
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
      <div className="space-y-2.5">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-[28px] font-extrabold leading-none tabular-nums text-foreground">
            {a.weekDrinks}
          </span>
          <span className="text-[12px] font-semibold text-muted-foreground">
            {a.weekDrinks === 1 ? "drink" : "drinks"} this week
          </span>
        </div>
        <WeekBars week={week} animate={animate} />
        {/* Context, not pass/fail. NOTE: the engine has no weekly-drinks (~30/wk)
            target on this read, so we use the days budget it does provide. */}
        <p className="text-[11px] tabular-nums text-muted-foreground">
          {a.drinkingDaysThisWeek} of {a.drinkingBudget} free days used this week
        </p>
      </div>
    </InsightTile>
  );
}

// Shared guard so a stray alcohol insight without its payload renders nothing.
export function isAlcoholInsight(ins: NutritionInsight): boolean {
  return (ins.id === "alcohol" || ins.id === "dryDays") && !!ins.alcohol;
}
