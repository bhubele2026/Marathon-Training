import {
  Activity,
  CalendarDays,
  CheckCircle2,
  Pencil,
  Target,
  TrendingDown,
  Zap,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PaletteDefinition, PaletteMode } from "./palettes";

const MILEAGE = [
  { week: "W6", planned: 22, actual: 21 },
  { week: "W7", planned: 26, actual: 27 },
  { week: "W8", planned: 28, actual: 25 },
  { week: "W9", planned: 32, actual: 33 },
  { week: "W10", planned: 35, actual: 31 },
  { week: "W11", planned: 38, actual: 38 },
  { week: "W12", planned: 30, actual: 28 },
];

const EQUIPMENT = [
  { name: "Treadmill", min: 220 },
  { name: "Tonal", min: 180 },
  { name: "Bike", min: 140 },
  { name: "Row", min: 95 },
  { name: "Outdoor", min: 60 },
];

interface ChartTokens {
  c1: string;
  c2: string;
  c3: string;
  c4: string;
  c5: string;
  border: string;
  muted: string;
  fg: string;
}

function chartTokens(palette: PaletteDefinition, mode: PaletteMode): ChartTokens {
  const t = palette[mode];
  return {
    c1: `hsl(${t.chart1})`,
    c2: `hsl(${t.chart2})`,
    c3: `hsl(${t.chart3})`,
    c4: `hsl(${t.chart4})`,
    c5: `hsl(${t.chart5})`,
    border: `hsl(${t.border})`,
    muted: `hsl(${t.mutedForeground})`,
    fg: `hsl(${t.foreground})`,
  };
}

export function MockDashboard({
  palette,
  mode,
}: {
  palette: PaletteDefinition;
  mode: PaletteMode;
}) {
  const tokens = chartTokens(palette, mode);
  const phaseColor = palette.phaseColors.tempo;

  const tooltipStyle = {
    backgroundColor: `hsl(${palette[mode].popover})`,
    border: `1px solid ${tokens.border}`,
    borderRadius: 6,
    color: tokens.fg,
    fontSize: 11,
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        <div
          className="bg-card border border-card-border rounded-md p-3 border-l-4"
          style={{ borderLeftColor: phaseColor }}
        >
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                Mission Status
              </div>
              <div className="text-xl font-black mt-0.5">Week 9</div>
              <div
                className="text-[10px] font-bold uppercase mt-0.5 flex items-center gap-1.5"
                style={{ color: phaseColor }}
              >
                <span
                  className="h-2 w-2 rounded-sm"
                  style={{ backgroundColor: phaseColor }}
                />
                Tempo/Threshold
              </div>
            </div>
            <CalendarDays className="h-5 w-5 text-muted-foreground opacity-50 shrink-0" />
          </div>
        </div>

        <div className="bg-card border border-card-border rounded-md p-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                Days to Race
              </div>
              <div className="text-xl font-black mt-0.5">42</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                Adherence{" "}
                <span className="text-foreground font-bold">87%</span>
              </div>
            </div>
            <Target className="h-5 w-5 text-muted-foreground opacity-50" />
          </div>
        </div>

        <div className="bg-card border border-card-border rounded-md p-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                Body Mass
              </div>
              <div className="text-xl font-black mt-0.5">182.4 lb</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                Goal 175 ·{" "}
                <span className="text-primary font-bold">-6.6</span>
              </div>
            </div>
            <TrendingDown className="h-5 w-5 text-muted-foreground opacity-50" />
          </div>
        </div>

        <div className="bg-card border border-card-border rounded-md p-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                Total Volume
              </div>
              <div className="text-xl font-black mt-0.5">348 mi</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                Long Run{" "}
                <span className="text-foreground font-bold">14.2 mi</span>
              </div>
            </div>
            <Activity className="h-5 w-5 text-muted-foreground opacity-50" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 space-y-4">
          <div className="border border-primary/30 bg-primary/5 rounded-md p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-bold uppercase tracking-wider text-primary">
                Today's Mission
              </div>
              <div className="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">
                Open Today →
              </div>
            </div>
            <div className="bg-card border border-card-border rounded-md p-3 flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="font-black text-base uppercase">
                  Tempo Run
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  6 mi @ 8:15/mi after 2 mi warmup. Hold steady through
                  miles 3–5.
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <div className="text-3xl font-black text-primary leading-none">
                    8.0
                  </div>
                  <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                    Miles Planned
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="text-[9px] bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">
                    Treadmill
                  </span>
                  <span className="text-[9px] bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">
                    Tonal Lower
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-1.5 shrink-0 w-32">
                <button className="bg-primary text-primary-foreground text-[10px] font-black uppercase tracking-widest py-1.5 rounded flex items-center justify-center gap-1">
                  <Zap className="h-3 w-3" /> Crushed It
                </button>
                <button className="bg-secondary text-secondary-foreground text-[10px] font-bold uppercase tracking-wider py-1.5 rounded flex items-center justify-center gap-1">
                  <Pencil className="h-3 w-3" /> Log Mission
                </button>
              </div>
            </div>
          </div>

          <div className="bg-card border border-card-border rounded-md p-4">
            <div className="text-xs font-bold uppercase tracking-wider mb-3">
              Weekly Mileage · Plan vs Actual
            </div>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={MILEAGE}
                  margin={{ top: 4, right: 8, left: -20, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={tokens.border}
                  />
                  <XAxis
                    dataKey="week"
                    tick={{ fontSize: 10, fill: tokens.muted }}
                    axisLine={{ stroke: tokens.border }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: tokens.muted }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: `${tokens.muted}22` }} />
                  <Legend
                    wrapperStyle={{ fontSize: 10, color: tokens.muted }}
                    iconSize={8}
                  />
                  <Bar
                    dataKey="planned"
                    fill={tokens.c2}
                    radius={[2, 2, 0, 0]}
                  />
                  <Bar
                    dataKey="actual"
                    fill={tokens.c1}
                    radius={[2, 2, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-card border border-card-border rounded-md p-4">
            <div className="text-xs font-bold uppercase tracking-wider mb-3">
              Equipment Mix
            </div>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={EQUIPMENT}
                  layout="vertical"
                  margin={{ top: 0, right: 8, left: 8, bottom: 0 }}
                >
                  <CartesianGrid
                    horizontal={false}
                    stroke={tokens.border}
                  />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 9, fill: tokens.muted }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fontSize: 10, fill: tokens.muted }}
                    axisLine={false}
                    tickLine={false}
                    width={60}
                  />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: `${tokens.muted}22` }} />
                  <Bar dataKey="min" radius={[0, 3, 3, 0]}>
                    {EQUIPMENT.map((_, i) => (
                      <Cell
                        key={i}
                        fill={[
                          tokens.c1,
                          tokens.c2,
                          tokens.c3,
                          tokens.c4,
                          tokens.c5,
                        ][i]}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-card border border-card-border rounded-md p-4">
            <div className="text-xs font-bold uppercase tracking-wider mb-3">
              Week 9 Snapshot
            </div>
            <div className="space-y-2.5">
              {[
                { label: "Mileage", val: 28, max: 32, txt: "28 / 32 mi" },
                { label: "Load", val: 740, max: 820, txt: "740 / 820" },
                { label: "Sessions", val: 4, max: 5, txt: "4 / 5" },
              ].map((row) => (
                <div key={row.label} className="space-y-1">
                  <div className="flex justify-between text-[10px] font-bold uppercase">
                    <span>{row.label}</span>
                    <span>{row.txt}</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded overflow-hidden">
                    <div
                      className="h-full bg-primary rounded"
                      style={{
                        width: `${Math.min(100, (row.val / row.max) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-1.5 text-[10px] text-primary font-bold uppercase tracking-wider">
              <CheckCircle2 className="h-3 w-3" /> On Pace
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
