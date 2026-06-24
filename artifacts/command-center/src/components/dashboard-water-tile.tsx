import { useQuery } from "@tanstack/react-query";
import { WaterTracker } from "@/components/studio";

// Self-contained hydration tile for the Dashboard hub + Nutrition page. Reads
// the same `/api/nutrition/recent` feed the Nutrition page uses (shared cache
// key) and derives today's oz + 7/30-day averages CLIENT-SIDE from the
// per-day `waterMl` already synced from Apple Health — no new endpoint. The
// goal defaults to ~1/2 oz per lb of bodyweight (passed in), falling back to a
// flat 64 oz when weight is unknown. (Phase 13 will add manual + first-class
// water writes; this is the read-side presentation that retires the old
// "Awaiting sync · —" orphan line.)
const ML_PER_OZ = 29.5735;

type NutritionDay = {
  date: string;
  waterMl: number | null;
};
type RecentResponse = { days: number; entries: NutritionDay[] };

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

function localTodayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function avgOz(entries: NutritionDay[], n: number): number | null {
  const withWater = entries
    .filter((e) => e.waterMl != null && e.waterMl > 0)
    .slice(0, n);
  if (withWater.length === 0) return null;
  const totalMl = withWater.reduce((s, e) => s + (e.waterMl ?? 0), 0);
  return totalMl / withWater.length / ML_PER_OZ;
}

export function DashboardWaterTile({
  weightLb,
  className,
}: {
  weightLb?: number | null;
  className?: string;
}) {
  const { data } = useQuery({
    queryKey: ["/api/nutrition/recent", 90],
    queryFn: () => getJson<RecentResponse>("/api/nutrition/recent?days=90"),
  });

  const entries = data?.entries ?? [];
  // Recent feed is newest-first per the Nutrition page; be defensive and find
  // by local date instead of assuming index 0.
  const todayMl =
    entries.find((e) => e.date === localTodayStr())?.waterMl ?? 0;
  const oz = Math.round(todayMl / ML_PER_OZ);
  const goalOz =
    weightLb != null && weightLb > 0 ? Math.round(weightLb * 0.5) : 64;

  return (
    <WaterTracker
      oz={oz}
      goalOz={goalOz}
      weeklyAvgOz={avgOz(entries, 7)}
      monthlyAvgOz={avgOz(entries, 30)}
      className={className}
    />
  );
}
