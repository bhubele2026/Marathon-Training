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
import { cn } from "@/lib/utils";

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
  // Optional per-day provenance. /api/nutrition/recent reads the nutrition_days
  // rollup, which currently does NOT carry a source — so this is omitted in
  // practice. The column renders only when at least one day reports a source,
  // so the table degrades gracefully without inventing data.
  source?: string | null;
};
type RecentResponse = { days: number; entries: NutritionDay[] };

const HISTORY_DAYS = 90;
const ML_PER_FL_OZ = 29.5735;
const mlToOz = (ml: number | null): string =>
  ml == null ? "—" : `${Math.round(ml / ML_PER_FL_OZ)} oz`;

// Each macro column wears its signature chart token as a tiny dot, matching the
// rings/trends elsewhere in the nutrition slice (calories=azure, protein=violet,
// carbs=teal, fat=amber, water=cyan, sodium=warning/amber).
const MACRO_COLUMNS = [
  { label: "Calories", color: "hsl(var(--chart-1))" },
  { label: "Protein", color: "hsl(var(--chart-2))" },
  { label: "Carbs", color: "hsl(var(--chart-3))" },
  { label: "Fat", color: "hsl(var(--chart-4))" },
  { label: "Water", color: "hsl(var(--chart-5))" },
  { label: "Sodium", color: "hsl(var(--warning))" },
] as const;

const EYEBROW =
  "text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground";

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

// A macro-tinted legend dot rendered before each header label.
function MacroDot({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
    />
  );
}

// Provenance pill. Synced wears an azure tint; manual a neutral one. Both use
// color-mix against --card so the tint reads in light AND dark.
function SourceBadge({ source }: { source: string }) {
  const synced = source !== "manual";
  const label = synced ? "Synced" : "Manual";
  const style = synced
    ? {
        backgroundColor:
          "color-mix(in oklab, hsl(var(--chart-1)) 16%, var(--card))",
        color: "hsl(var(--chart-1))",
      }
    : {
        backgroundColor:
          "color-mix(in oklab, var(--muted-foreground) 16%, var(--card))",
        color: "hsl(var(--muted-foreground))",
      };
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide"
      style={style}
      data-testid={`log-source-${label.toLowerCase()}`}
    >
      {label}
    </span>
  );
}

// `onSelectDate` (optional) makes each row a button that jumps the day
// navigator to that day; `selectedDate` highlights the row under review.
// `todayDate` (optional) marks "today"; when omitted we treat the most recent
// logged day as today.
export function NutritionLog({
  onSelectDate,
  selectedDate,
  todayDate,
}: {
  onSelectDate?: (date: string) => void;
  selectedDate?: string;
  todayDate?: string;
} = {}) {
  const { data, isLoading } = useQuery({
    queryKey: ["/api/nutrition/recent", HISTORY_DAYS],
    queryFn: () => getJson<RecentResponse>(`/api/nutrition/recent?days=${HISTORY_DAYS}`),
  });

  // Only days that actually have intake logged.
  const logged = (data?.entries ?? []).filter(
    (e) => e.calories != null || e.proteinG != null,
  );

  // "Today" = the explicit prop, else the newest logged day (entries are
  // already newest-first from the endpoint).
  const today = todayDate ?? logged[0]?.date;

  // Only surface the source column when the data actually carries provenance.
  const hasSource = logged.some((e) => e.source != null);

  return (
    <Card data-testid="card-nutrition-log">
      <CardHeader>
        <CardTitle className="font-display text-base font-bold tracking-tight text-foreground">
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
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className={EYEBROW}>Date</TableHead>
                {MACRO_COLUMNS.map((col) => (
                  <TableHead key={col.label} className={cn(EYEBROW, "text-right")}>
                    <span className="inline-flex items-center justify-end gap-1.5">
                      <MacroDot color={col.color} />
                      {col.label}
                    </span>
                  </TableHead>
                ))}
                {hasSource ? (
                  <TableHead className={cn(EYEBROW, "text-right")}>Source</TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {logged.map((e) => {
                const isSelected = e.date === selectedDate;
                const isToday = e.date === today;
                return (
                  <TableRow
                    key={e.date}
                    onClick={onSelectDate ? () => onSelectDate(e.date) : undefined}
                    className={cn(
                      "transition-colors",
                      onSelectDate && "cursor-pointer",
                      "hover:bg-muted/40",
                      isToday && "bg-primary/5",
                      isSelected && "bg-primary/10 ring-1 ring-inset ring-primary/30",
                    )}
                    data-testid={`log-row-${e.date}`}
                    data-today={isToday ? "" : undefined}
                  >
                    <TableCell
                      className={cn(
                        "font-medium whitespace-nowrap",
                        isToday && "border-l-2 border-l-primary",
                      )}
                    >
                      {fmtDate(e.date)}
                      {isToday ? (
                        <span className="ml-2 text-[10px] font-semibold uppercase tracking-wider text-primary">
                          Today
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums font-bold text-[hsl(var(--chart-1))]">
                      {num(e.calories)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {num(e.proteinG)}{e.proteinG != null ? " g" : ""}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {num(e.carbsG)}{e.carbsG != null ? " g" : ""}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {num(e.fatG)}{e.fatG != null ? " g" : ""}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {mlToOz(e.waterMl)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {num(e.sodiumMg)}{e.sodiumMg != null ? " mg" : ""}
                    </TableCell>
                    {hasSource ? (
                      <TableCell className="text-right">
                        {e.source != null ? <SourceBadge source={e.source} /> : null}
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
