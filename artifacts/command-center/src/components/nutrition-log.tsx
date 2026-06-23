import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

// A plain per-day history of logged nutrition — every day that has data, newest
// first, with the actual numbers (not just the trend bars). Reads the same
// /api/nutrition/recent endpoint as the trend; pulls a 90-day window so older
// days are visible too. Hand-fetched like the rest of the nutrition slice.

type NutritionDay = {
  date: string;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  sodiumMg: number | null;
  waterMl: number | null;
};
type RecentResponse = { days: number; entries: NutritionDay[] };

const HISTORY_DAYS = 90;
const ML_PER_FL_OZ = 29.5735;
const mlToOz = (ml: number | null): string =>
  ml == null ? "—" : `${Math.round(ml / ML_PER_FL_OZ)} oz`;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

function fmtDate(iso: string): string {
  // iso is YYYY-MM-DD (UTC day). Render without TZ shifting the calendar day.
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  return dt.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

const num = (n: number | null): string => (n == null ? "—" : Math.round(n).toLocaleString());

export function NutritionLog() {
  const { data, isLoading } = useQuery({
    queryKey: ["/api/nutrition/recent", HISTORY_DAYS],
    queryFn: () => getJson<RecentResponse>(`/api/nutrition/recent?days=${HISTORY_DAYS}`),
  });

  // Only days that actually have intake logged.
  const logged = (data?.entries ?? []).filter(
    (e) => e.calories != null || e.proteinG != null,
  );

  return (
    <Card data-testid="card-nutrition-log">
      <CardHeader>
        <CardTitle className="text-sm tracking-wider text-muted-foreground">
          Nutrition log
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Every day you've logged, newest first.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : logged.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No nutrition logged yet. Once your Apple Shortcut syncs a day, it shows up here.
          </p>
        ) : (
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="text-[10px] font-bold tracking-wider">Date</TableHead>
                <TableHead className="text-[10px] font-bold tracking-wider text-right">Calories</TableHead>
                <TableHead className="text-[10px] font-bold tracking-wider text-right">Protein</TableHead>
                <TableHead className="text-[10px] font-bold tracking-wider text-right">Carbs</TableHead>
                <TableHead className="text-[10px] font-bold tracking-wider text-right">Fat</TableHead>
                <TableHead className="text-[10px] font-bold tracking-wider text-right">Water</TableHead>
                <TableHead className="text-[10px] font-bold tracking-wider text-right">Sodium</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logged.map((e) => (
                <TableRow key={e.date} className="hover:bg-muted/30">
                  <TableCell className="font-medium whitespace-nowrap">{fmtDate(e.date)}</TableCell>
                  <TableCell className="text-right font-mono font-bold text-primary">{num(e.calories)}</TableCell>
                  <TableCell className="text-right font-mono">{num(e.proteinG)}{e.proteinG != null ? " g" : ""}</TableCell>
                  <TableCell className="text-right font-mono">{num(e.carbsG)}{e.carbsG != null ? " g" : ""}</TableCell>
                  <TableCell className="text-right font-mono">{num(e.fatG)}{e.fatG != null ? " g" : ""}</TableCell>
                  <TableCell className="text-right font-mono">{mlToOz(e.waterMl)}</TableCell>
                  <TableCell className="text-right font-mono">{num(e.sodiumMg)}{e.sodiumMg != null ? " mg" : ""}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
