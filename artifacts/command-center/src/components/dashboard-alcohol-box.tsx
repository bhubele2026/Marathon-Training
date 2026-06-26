import { useGetAlcoholSummary, type AlcoholSummary } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RadialGauge } from "@/components/insights/radial-gauge";
import { AlcoholLogButton } from "@/components/alcohol-log-button";

// Dashboard alcohol box — replaces the dead "Goal progress" placeholder. A
// reduction tool, so it reads win-not-shame: dry days this week vs the goal lead
// (a compact donut), the current streak + weeks-on-target, drinks this week with
// a one-line status, and a quick "+ drink" log. All colour from theme tokens →
// light + dark; same Card shell + eyebrow as its sibling tiles.

const eyebrow =
  "text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground self-start";

export function DashboardAlcoholBox() {
  const { data, isLoading } = useGetAlcoholSummary();

  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 p-6">
        <p className={eyebrow}>Alcohol</p>
        {isLoading || !data ? (
          <Skeleton className="h-[120px] w-full rounded-2xl" />
        ) : !data.active ? (
          <Empty
            line="No drinks logged yet."
            hint={`Tap "+ drink" to start tracking — dry days are the win.`}
          />
        ) : (
          <Live data={data} />
        )}
        <AlcoholLogButton triggerLabel="+ drink" triggerClassName="h-8 px-3 text-xs" showMarkDry />
      </CardContent>
    </Card>
  );
}

function Empty({ line, hint }: { line: string; hint: string }) {
  return (
    <div className="flex flex-col items-center gap-1 py-4 text-center">
      <p className="text-sm font-semibold text-foreground">{line}</p>
      <p className="max-w-[14rem] text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function Live({ data }: { data: AlcoholSummary }) {
  const hit = data.dryDaysThisWeek >= data.dryDaysTarget;
  const pct = data.dryDaysTarget > 0 ? data.dryDaysThisWeek / data.dryDaysTarget : 0;
  const gaugeColor = data.seedState
    ? "hsl(var(--muted-foreground))"
    : hit
      ? "hsl(var(--success))"
      : "hsl(var(--warning))";
  const overBudget = data.drinkingDaysThisWeek > data.drinkingBudget;
  const status = data.seedState
    ? "Early days — keep logging."
    : hit
      ? "Dry-day goal hit this week 🙌"
      : overBudget
        ? `Over your ${data.drinkingBudget}-day budget this week.`
        : `${data.dryDaysTarget - data.dryDaysThisWeek} dry day(s) to go this week.`;

  return (
    <div className="flex w-full items-center gap-4">
      <RadialGauge
        pct={Math.max(0, Math.min(1, pct))}
        color={gaugeColor}
        size={92}
        stroke={10}
        centerMain={`${data.dryDaysThisWeek}`}
        centerSub={`/${data.dryDaysTarget} dry`}
      />
      <div className="min-w-0 space-y-1.5">
        <div className="text-[12.5px] font-semibold text-foreground">{status}</div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-muted-foreground">
          {data.currentDryStreak > 0 && (
            <span className="font-mono tabular-nums">🔥 {data.currentDryStreak}-day streak</span>
          )}
          {data.weeksTracked > 0 && (
            <span className="font-mono tabular-nums">
              {data.weeksOnTarget}/{data.weeksTracked} wk on target
            </span>
          )}
        </div>
        <div className="font-mono text-[11.5px] tabular-nums text-muted-foreground">
          {data.weekDrinks} {data.weekDrinks === 1 ? "drink" : "drinks"} this week ·{" "}
          {data.drinkingDaysThisWeek}/{data.drinkingBudget} days
        </div>
      </div>
    </div>
  );
}
