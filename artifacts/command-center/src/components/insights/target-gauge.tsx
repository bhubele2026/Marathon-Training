import { GoalArc } from "@/components/studio/goal-arc";
import { cn } from "@/lib/utils";

// TargetGauge — an arc for days-on-target (daysHit / daysLogged), e.g.
// "33% — 1 of 3 days on target". Thin wrapper over the studio GoalArc so the
// motion + reduced-motion behaviour stays consistent. Pure presentation.

export interface TargetGaugeProps {
  daysHit?: number | null;
  daysLogged?: number | null;
  label?: string;
  size?: number;
  className?: string;
}

export function TargetGauge({
  daysHit,
  daysLogged,
  label = "on target",
  size = 132,
  className,
}: TargetGaugeProps) {
  const hit = daysHit ?? 0;
  const logged = daysLogged ?? 0;
  const value = logged > 0 ? hit / logged : 0;
  const caption =
    logged > 0 ? `${hit} of ${logged} days` : "No logged days yet";
  return (
    <div className={cn("inline-flex", className)} data-testid="target-gauge">
      <GoalArc value={value} label={label} caption={caption} size={size} />
    </div>
  );
}
