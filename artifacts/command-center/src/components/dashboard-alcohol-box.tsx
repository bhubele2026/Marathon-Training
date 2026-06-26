import { useGetAlcoholSummary, type AlcoholSummary } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RadialGauge } from "@/components/insights/radial-gauge";
import { AlcoholLogButton } from "@/components/alcohol-log-button";

// Dashboard alcohol box — a reduction tool, so it reads win-not-shame: a compact
// dry-days-vs-goal donut leads, a scannable stat row (streak · weeks on target ·
// drinks) sits below — same mono-numeral + uppercase-eyebrow shape as the
// Activity card so the two feel like siblings — and a "+ drink" quick-log
// anchors the card. All colour from theme tokens → light + dark.

const eyebrow =
  "text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground";

// One scannable stat — mono numeral + uppercase eyebrow (mirrors the Activity
// card footer).
function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 text-center">
      <span className="font-mono text-[15px] font-bold leading-none tabular-nums tracking-tight text-foreground">
        {value}
      </span>
      <span className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

export function DashboardAlcoholBox() {
  const { data, isLoading } = useGetAlcoholSummary();

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5">
        <p className={eyebrow}>Alcohol</p>
        {isLoading || !data ? (
          <div className="flex flex-col items-center gap-3 py-2">
            <Skeleton className="h-[108px] w-[108px] rounded-full" />
            <Skeleton className="h-9 w-full rounded-md" />
          </div>
        ) : !data.active ? (
          <Empty target={data.dryDaysTarget} />
        ) : (
          <Live data={data} />
        )}
      </CardContent>
    </Card>
  );
}

// Quick-log, placed identically in both states so the card never looks broken.
function LogButton() {
  return (
    <AlcoholLogButton
      triggerLabel="+ drink"
      triggerClassName="h-8 w-full justify-center px-3 text-xs"
      showMarkDry
    />
  );
}

// Early / empty state — same donut-led layout, faded, so it reads as an
// invitation rather than an empty card.
function Empty({ target }: { target: number }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <RadialGauge
        pct={0}
        color="hsl(var(--muted-foreground))"
        size={104}
        stroke={11}
        centerMain={`0/${target}`}
        centerSub="dry"
      />
      <div className="text-center">
        <p className="text-sm font-semibold text-foreground">No drinks logged yet</p>
        <p className="mx-auto max-w-[15rem] text-xs text-muted-foreground">
          Tap “+ drink” to start tracking — dry days are the win.
        </p>
      </div>
      <LogButton />
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
  // Positive framing — lead with the dry-day win, never the drink count.
  const status = data.seedState
    ? "Early days — keep logging."
    : hit
      ? "Dry-day goal hit this week 🙌"
      : overBudget
        ? `Over your ${data.drinkingBudget}-day budget this week.`
        : `${data.dryDaysTarget - data.dryDaysThisWeek} dry day(s) to go this week.`;

  return (
    <div className="flex flex-col items-center gap-3">
      {/* Dry days vs target — the win, centered in the donut. */}
      <RadialGauge
        pct={Math.max(0, Math.min(1, pct))}
        color={gaugeColor}
        size={104}
        stroke={11}
        centerMain={`${data.dryDaysThisWeek}/${data.dryDaysTarget}`}
        centerSub="dry"
      />
      <p className="text-center text-[12.5px] font-medium text-foreground">{status}</p>

      {/* Secondary signals as a scannable row (siblings of the Activity footer). */}
      <div className="grid w-full grid-cols-3 gap-2 border-t border-card-border pt-3">
        <Stat value={`🔥 ${data.currentDryStreak}`} label="Day streak" />
        <Stat
          value={data.weeksTracked > 0 ? `${data.weeksOnTarget}/${data.weeksTracked}` : "—"}
          label="Wks on target"
        />
        <Stat
          value={String(data.weekDrinks)}
          label={data.weekDrinks === 1 ? "Drink" : "Drinks"}
        />
      </div>

      <LogButton />
    </div>
  );
}
