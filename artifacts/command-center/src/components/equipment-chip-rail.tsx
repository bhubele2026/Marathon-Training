import { cn } from "@/lib/utils";

type EquipmentChipRailProps = {
  equipmentList?: readonly string[] | null;
  equipment?: string | null;
  chipTestIdPrefix: string;
  railTestId?: string;
  className?: string;
  keyPrefix?: string;
};

export function EquipmentChipRail({
  equipmentList,
  equipment,
  chipTestIdPrefix,
  railTestId,
  className,
  keyPrefix = "eq",
}: EquipmentChipRailProps) {
  const items = equipmentList ?? (equipment ? [equipment] : []);
  if (items.length === 0) return null;
  return (
    <div
      className={cn("flex flex-wrap gap-2", className)}
      data-testid={railTestId}
    >
      {items.map((eq, idx) => (
        <span
          key={`${keyPrefix}-${idx}`}
          className="text-[10px] bg-secondary text-secondary-foreground px-2 py-1 rounded font-bold uppercase tracking-wider"
          data-testid={`${chipTestIdPrefix}-${idx}`}
        >
          {eq}
        </span>
      ))}
    </div>
  );
}
