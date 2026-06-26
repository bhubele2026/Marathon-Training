import { motion, useReducedMotion } from "framer-motion";
import type { NutritionInsight, AlcoholDay, AlcoholWeek } from "./types";
import { InsightTile, type PillSpec } from "./insight-tile";
import { RadialGauge } from "./radial-gauge";

// The two alcohol scorecard tiles — the FUN ones. A reduction tool, so the read
// is win-not-shame: dry days count UP (green), drinking within the weekly budget
// is NEUTRAL (grey, never red), over budget is a soft amber nudge. All colour
// from theme tokens → correct in light AND dark; animations respect reduced
// motion. Both tiles draw from the one server-computed `insight.alcohol` read.

const DOW = ["S", "M", "T", "W", "T", "F", "S"];
function dowLetter(date: string): string {
  return DOW[new Date(`${date}T12:00:00Z`).getUTCDay()] ?? "·";
}

// --- 7-day intake strip -----------------------------------------------------
// One mini bar per day: grey bar scaled to drinks (neutral, not red), a green
// dot for a dry day, a faint baseline for pending/untracked days.
function BarStrip({ days }: { days: AlcoholDay[] }) {
  const reduced = useReducedMotion();
  const maxDrinks = Math.max(2, ...days.map((d) => d.drinks));
  const TRACK = 52; // px
  return (
    <div className="flex items-end gap-1.5" data-testid="alcohol-bar-strip">
      {days.map((d, i) => {
        const h = d.drinks > 0 ? Math.max(6, Math.round((d.drinks / maxDrinks) * TRACK)) : 0;
        return (
          <div key={d.date} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <div className="relative w-full" style={{ height: TRACK }}>
              {d.drinks > 0 ? (
                <motion.div
                  className="absolute inset-x-0 bottom-0 rounded-t-[3px]"
                  style={{ background: "color-mix(in oklab, var(--muted-foreground) 70%, var(--card))" }}
                  initial={reduced ? { height: h } : { height: 0 }}
                  animate={{ height: h }}
                  transition={reduced ? { duration: 0 } : { duration: 0.5, delay: i * 0.04, ease: "easeOut" }}
                  aria-hidden="true"
                />
              ) : d.isDry ? (
                <motion.div
                  className="absolute inset-x-0 bottom-0 flex justify-center"
                  initial={reduced ? { opacity: 1 } : { opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={reduced ? { duration: 0 } : { duration: 0.3, delay: i * 0.04 }}
                  aria-hidden="true"
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: "hsl(var(--success))" }}
                  />
                </motion.div>
              ) : (
                <div
                  className="absolute inset-x-0 bottom-0 h-px"
                  style={{ background: "color-mix(in oklab, var(--muted-foreground) 25%, var(--card))" }}
                  aria-hidden="true"
                />
              )}
            </div>
            <span className="text-[10px] font-semibold tabular-nums text-muted-foreground">
              {d.drinks > 0 ? d.drinks : ""}
            </span>
            <span className="text-[9px] uppercase text-muted-foreground/70">{dowLetter(d.date)}</span>
          </div>
        );
      })}
    </div>
  );
}

// --- week-over-week dry-day dots --------------------------------------------
// One dot per recent week: green when it hit the dry-day target, grey when it
// missed, a ring for the in-progress week. The win streak reads left → right.
function WeekDots({ weeks }: { weeks: AlcoholWeek[] }) {
  const reduced = useReducedMotion();
  return (
    <div className="flex items-center gap-1.5" data-testid="dry-week-dots">
      {weeks.map((w, i) => {
        const bg = w.inProgress
          ? "transparent"
          : w.hitTarget
            ? "hsl(var(--success))"
            : "color-mix(in oklab, var(--muted-foreground) 30%, var(--card))";
        return (
          <motion.span
            key={w.weekStart}
            className="h-2.5 w-2.5 rounded-full"
            style={{
              background: bg,
              border: w.inProgress
                ? `1.5px solid ${w.hitTarget ? "hsl(var(--success))" : "hsl(var(--muted-foreground))"}`
                : "none",
            }}
            title={`Week of ${w.weekStart}: ${w.dryDays} dry${w.inProgress ? " (so far)" : ""}`}
            initial={reduced ? { scale: 1 } : { scale: 0 }}
            animate={{ scale: 1 }}
            transition={reduced ? { duration: 0 } : { duration: 0.25, delay: i * 0.05 }}
            aria-hidden="true"
          />
        );
      })}
    </div>
  );
}

// --- Dry days tile (the win) ------------------------------------------------
export function DryDaysTile({ insight }: { insight: NutritionInsight }) {
  const a = insight.alcohol;
  if (!a) return null;
  const hit = a.dryDaysThisWeek >= a.dryDaysTarget;
  const pct = a.dryDaysTarget > 0 ? a.dryDaysThisWeek / a.dryDaysTarget : 0;
  const gaugeColor = a.seedState
    ? "hsl(var(--muted-foreground))"
    : hit
      ? "hsl(var(--success))"
      : "hsl(var(--warning))";
  const trendLine = a.weeksTracked > 0
    ? `${a.weeksOnTarget} of ${a.weeksTracked} wk · avg ${a.avgDryPerWeek ?? "—"} dry/wk` +
      (a.weeksOnTargetStreak > 0 ? ` · ${a.weeksOnTargetStreak}-wk streak` : "")
    : "trend builds as weeks complete";

  const drawer = (
    <div className="space-y-3">
      <ul className="space-y-1.5">
        {a.weeklyTrend.map((w) => (
          <li key={w.weekStart} className="flex items-center justify-between text-[12.5px]">
            <span className="text-muted-foreground">
              Wk of {w.weekStart.slice(5)}
              {w.inProgress && <span className="ml-1 text-[10px] uppercase">· now</span>}
            </span>
            <span
              className="font-mono font-semibold tabular-nums"
              style={{
                color: w.hitTarget ? "hsl(var(--success))" : "hsl(var(--muted-foreground))",
              }}
            >
              {w.dryDays} dry {w.hitTarget ? "✓" : ""}
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
      caption={insight.caption}
      whyLabel="Why + week-by-week"
      drawer={drawer}
    >
      <div className="flex items-center gap-3.5">
        <RadialGauge
          pct={Math.max(0, Math.min(1, pct))}
          color={gaugeColor}
          centerMain={`${a.dryDaysThisWeek}`}
          centerSub={`/${a.dryDaysTarget} dry`}
        />
        <div className="min-w-0 space-y-2">
          <WeekDots weeks={a.weeklyTrend} />
          <div className="font-mono text-[12.5px] font-semibold tabular-nums text-foreground">
            {trendLine}
          </div>
          <div className="text-[11.5px] text-muted-foreground">
            {a.currentDryStreak > 0
              ? `🔥 ${a.currentDryStreak}-day dry streak`
              : "log a dry day to start a streak"}
          </div>
        </div>
      </div>
    </InsightTile>
  );
}

// --- Alcohol intake tile (what it costs; never red) -------------------------
export function AlcoholTile({ insight }: { insight: NutritionInsight }) {
  const a = insight.alcohol;
  if (!a) return null;
  const overBudget = a.drinkingDaysThisWeek > a.drinkingBudget;
  // Pill is forced to a non-status tone so within-budget reads NEUTRAL (grey),
  // not the green "win" border — over budget is a soft amber nudge, never red.
  const pill: PillSpec = a.seedState
    ? { tone: "neutral", label: "early read", glyph: "⏳" }
    : overBudget
      ? { tone: "warning", label: "over budget", glyph: "▴" }
      : { tone: "neutral", label: "in budget", glyph: "✓" };

  const drawer = (
    <div className="space-y-3">
      {a.impact.length > 0 ? (
        <ul className="space-y-2">
          {a.impact.map((im) => (
            <li key={im.key} className="text-[12.5px]">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-foreground">{im.label}</span>
                {im.drinkingAvg != null && im.dryAvg != null && (
                  <span className="font-mono tabular-nums text-muted-foreground">
                    <span style={{ color: "hsl(var(--muted-foreground))" }}>{im.drinkingAvg}</span>
                    {" vs "}
                    <span style={{ color: "hsl(var(--success))" }}>{im.dryAvg}</span>
                    {im.deltaPct != null && (
                      <span
                        className="ml-1"
                        style={{
                          color:
                            (im.deltaPct < 0) === im.betterWhenDry
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
            "Keep logging — once there's about two weeks I can compare drinking days to dry days (next-day training, protein, calories, hydration)."}
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
          <span className="font-mono text-[26px] font-bold leading-none tabular-nums text-foreground">
            {a.weekDrinks}
          </span>
          <span className="text-[12px] font-semibold text-muted-foreground">
            {a.weekDrinks === 1 ? "drink" : "drinks"} this week
          </span>
        </div>
        <BarStrip days={a.dailyStrip} />
        {a.impact[0] && (
          <p className="text-[11.5px] leading-snug text-muted-foreground">{a.impact[0].note}</p>
        )}
      </div>
    </InsightTile>
  );
}

// Shared guard so a stray alcohol insight without its payload renders nothing.
export function isAlcoholInsight(ins: NutritionInsight): boolean {
  return (ins.id === "alcohol" || ins.id === "dryDays") && !!ins.alcohol;
}
