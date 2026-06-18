import { cn } from "@/lib/utils";

type EquipmentChipRailProps = {
  equipmentList?: readonly string[] | null;
  equipment?: string | null;
  chipTestIdPrefix: string;
  railTestId?: string;
  className?: string;
  keyPrefix?: string;
  minutesByIndex?: readonly number[] | null;
};

export function EquipmentChipRail({
  equipmentList,
  equipment,
  chipTestIdPrefix,
  railTestId,
  className,
  keyPrefix = "eq",
  minutesByIndex,
}: EquipmentChipRailProps) {
  const items = equipmentList ?? (equipment ? [equipment] : []);
  if (items.length === 0) return null;
  return (
    <div
      className={cn("flex flex-wrap gap-2", className)}
      data-testid={railTestId}
    >
      {items.map((eq, idx) => {
        const min = minutesByIndex?.[idx] ?? 0;
        return (
          <span
            key={`${keyPrefix}-${idx}`}
            className="text-[10px] bg-secondary text-secondary-foreground px-2 py-1 rounded font-bold tracking-wider"
            data-testid={`${chipTestIdPrefix}-${idx}`}
          >
            {eq}
            {min > 0 && (
              <span
                className="text-primary ml-1"
                data-testid={`${chipTestIdPrefix}-${idx}-minutes`}
              >
                · {min} MIN
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

export function classifyEquipmentBucket(
  eq: string,
): "strength" | "cardio" | "run" | null {
  if (eq === "Tonal") return "strength";
  if (eq === "Peloton Tread" || eq === "Outdoor") return "run";
  if (eq === "Peloton Bike" || eq === "Peloton Row") return "cardio";
  return null;
}

export function splitMinutesByEquipment(
  equipmentList: readonly string[] | null | undefined,
  strengthMin: number | null | undefined,
  cardioMin: number | null | undefined,
  runMin: number | null | undefined,
): number[] {
  const list = equipmentList ?? [];
  const buckets = list.map(classifyEquipmentBucket);
  const counts = { strength: 0, cardio: 0, run: 0 };
  for (const b of buckets) if (b) counts[b]++;
  return buckets.map((b) => {
    if (!b) return 0;
    const total =
      b === "strength"
        ? (strengthMin ?? 0)
        : b === "cardio"
          ? (cardioMin ?? 0)
          : (runMin ?? 0);
    if (total <= 0 || counts[b] === 0) return 0;
    return Math.round(total / counts[b]);
  });
}
