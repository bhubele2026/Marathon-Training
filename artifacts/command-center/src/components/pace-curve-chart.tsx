import { useMemo } from "react";
import {
  AreaChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
  ComposedChart,
  Legend,
} from "recharts";
import {
  DEFAULT_STARTING_PACE_SEC,
  RACE_KIND_EASY_OFFSET_SEC,
  RACE_KIND_LONG_EXTRA_OFFSET_SEC,
  RAMP_SEC_PER_WEEK,
} from "@workspace/plan-generator";
import { phaseColor } from "@/lib/phase-colors";

// Task #374. Sparkline-style chart that previews the start → goal pace
// curve across the campaign. Lives inside the /plan "Update Starting
// Pace" dialog so the runner can see live what their typed anchors
// produce week by week, with race-distance offsets and phase bands
// overlaid so an unrealistic goal is visually obvious before they hit
// Update. Uses the same ramp math as `computeEffectivePace` +
// `applyRaceKindPaceOffset` on the generator side so the preview
// matches what the backfill will write.

export interface PaceCurveWeek {
  week: number;
  phase: string;
}

interface PaceCurveChartProps {
  startSec: number | null;
  goalSec: number | null;
  totalWeeks: number;
  raceKind: string | null;
  weeks: PaceCurveWeek[];
}

function paceForWeek(
  startSec: number,
  goalSec: number | null,
  campaignWeek: number,
  totalWeeks: number,
): number {
  if (goalSec !== null && totalWeeks > 1) {
    const t = Math.max(
      0,
      Math.min(1, (campaignWeek - 1) / (totalWeeks - 1)),
    );
    return startSec + (goalSec - startSec) * t;
  }
  return startSec - Math.max(0, campaignWeek - 1) * RAMP_SEC_PER_WEEK;
}

function fmtPaceTick(sec: number): string {
  const safe = Math.max(0, Math.round(sec));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function PaceCurveChart({
  startSec,
  goalSec,
  totalWeeks,
  raceKind,
  weeks,
}: PaceCurveChartProps) {
  const effectiveStart = startSec ?? DEFAULT_STARTING_PACE_SEC;
  const easyOffset = RACE_KIND_EASY_OFFSET_SEC[raceKind ?? "none"] ?? 0;
  const longExtra =
    RACE_KIND_LONG_EXTRA_OFFSET_SEC[raceKind ?? "none"] ?? 0;

  const data = useMemo(() => {
    const n = Math.max(1, totalWeeks);
    const phaseByWeek = new Map<number, string>();
    for (const w of weeks) phaseByWeek.set(w.week, w.phase);
    const out: {
      week: number;
      phase: string;
      easy: number;
      long: number;
      base: number;
    }[] = [];
    for (let w = 1; w <= n; w++) {
      // Mirror `computeEffectivePace` + `applyRaceKindPaceOffset`:
      //   rampedEasy = round(base)
      //   rampedLong = rampedEasy + 30           (recipe long delta)
      //   easyOut   = rampedEasy + easyOffset    (race-kind offset)
      //   longOut   = rampedLong + easyOffset + longExtra
      // Recipe per-phase floor clamps are intentionally omitted — the
      // preview shows the unclamped curve so a goal that would be
      // pinned to the floor still visibly "bottoms out" against the
      // axis instead of silently flattening behind the scenes.
      const base = paceForWeek(effectiveStart, goalSec, w, n);
      const rampedEasy = Math.round(base);
      const rampedLong = rampedEasy + 30;
      const easy = rampedEasy + easyOffset;
      const long = rampedLong + easyOffset + longExtra;
      out.push({
        week: w,
        phase: phaseByWeek.get(w) ?? "",
        easy,
        long,
        base: rampedEasy,
      });
    }
    return out;
  }, [effectiveStart, goalSec, totalWeeks, easyOffset, longExtra, weeks]);

  // Collapse consecutive same-phase weeks into [startWeek, endWeek] bands
  // so we can shade the chart background per training phase.
  const phaseBands = useMemo(() => {
    const bands: { phase: string; start: number; end: number }[] = [];
    for (const row of data) {
      if (!row.phase) continue;
      const last = bands[bands.length - 1];
      if (last && last.phase === row.phase && last.end === row.week - 1) {
        last.end = row.week;
      } else {
        bands.push({ phase: row.phase, start: row.week, end: row.week });
      }
    }
    return bands;
  }, [data]);

  // Y domain spans both lines with a small breathing margin so the
  // curve never hugs the chart edges.
  const allValues = data.flatMap((r) => [r.easy, r.long]);
  const yMin = Math.min(...allValues) - 20;
  const yMax = Math.max(...allValues) + 20;

  return (
    <div className="space-y-2" data-testid="pace-curve-chart">
      <div className="h-44 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            {phaseBands.map((b, i) => (
              <ReferenceArea
                key={`${b.phase}-${i}`}
                x1={b.start}
                x2={b.end}
                fill={phaseColor(b.phase)}
                fillOpacity={0.08}
                stroke="none"
                ifOverflow="hidden"
              />
            ))}
            <XAxis
              dataKey="week"
              type="number"
              domain={[1, Math.max(1, totalWeeks)]}
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickFormatter={(v) => `W${v}`}
              allowDecimals={false}
            />
            <YAxis
              domain={[yMin, yMax]}
              reversed
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickFormatter={fmtPaceTick}
              width={48}
            />
            <Tooltip
              contentStyle={{
                background: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                fontSize: 12,
              }}
              labelFormatter={(label, payload) => {
                const phase = payload?.[0]?.payload?.phase as
                  | string
                  | undefined;
                return phase ? `Week ${label} · ${phase}` : `Week ${label}`;
              }}
              formatter={(value: number, name) => [
                `${fmtPaceTick(value)}/mi`,
                name,
              ]}
            />
            <Legend
              wrapperStyle={{ fontSize: 11 }}
              iconType="line"
              verticalAlign="top"
              height={20}
            />
            <Area
              type="monotone"
              dataKey="long"
              name="Long"
              stroke="hsl(var(--chart-2))"
              fill="hsl(var(--chart-2))"
              fillOpacity={0.12}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="easy"
              name="Easy"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>
          Start W1: <span className="text-foreground font-bold">{fmtPaceTick(data[0]?.easy ?? 0)}/mi</span>
        </span>
        <span>
          End W{totalWeeks}: <span className="text-foreground font-bold">{fmtPaceTick(data[data.length - 1]?.easy ?? 0)}/mi</span>
        </span>
        {raceKind ? (
          <span>
            Race offset: <span className="text-foreground font-bold">+{easyOffset}s easy / +{easyOffset + longExtra}s long</span>
          </span>
        ) : null}
        {startSec === null ? (
          <span className="italic">Preview using recipe default {fmtPaceTick(DEFAULT_STARTING_PACE_SEC)}/mi</span>
        ) : null}
        {startSec !== null && goalSec === null ? (
          <span className="italic">Fixed ramp (~{RAMP_SEC_PER_WEEK.toFixed(2)}s/mi/wk faster)</span>
        ) : null}
      </div>
    </div>
  );
}
