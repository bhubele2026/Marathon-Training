import { Activity, AlertTriangle, CalendarDays, Sparkles, Target } from "lucide-react";
import type { PaletteDefinition, PaletteMode } from "./palettes";

interface WeekRow {
  week: number;
  miles: number;
  planned: number;
  longRun: number;
  active?: boolean;
  missed?: number;
  edited?: number;
}

const PHASES: Array<{
  label: string;
  key: keyof PaletteDefinition["phaseColors"];
  weeks: WeekRow[];
}> = [
  {
    label: "Foundation Build",
    key: "foundation",
    weeks: [
      { week: 1, miles: 16, planned: 16, longRun: 6 },
      { week: 2, miles: 18, planned: 18, longRun: 7 },
      { week: 3, miles: 20, planned: 20, longRun: 8 },
    ],
  },
  {
    label: "Aerobic Build",
    key: "aerobic",
    weeks: [
      { week: 4, miles: 22, planned: 22, longRun: 9, edited: 1 },
      { week: 5, miles: 24, planned: 24, longRun: 10 },
      { week: 6, miles: 24, planned: 26, longRun: 10, missed: 1 },
    ],
  },
  {
    label: "Tempo/Threshold",
    key: "tempo",
    weeks: [
      { week: 7, miles: 27, planned: 28, longRun: 11 },
      { week: 8, miles: 28, planned: 28, longRun: 12 },
      { week: 9, miles: 28, planned: 32, longRun: 12, active: true },
    ],
  },
  {
    label: "Race-Specific",
    key: "raceSpecific",
    weeks: [
      { week: 10, miles: 0, planned: 35, longRun: 14 },
      { week: 11, miles: 0, planned: 38, longRun: 16 },
    ],
  },
  {
    label: "Taper & Race",
    key: "taper",
    weeks: [
      { week: 12, miles: 0, planned: 28, longRun: 10 },
      { week: 13, miles: 0, planned: 14, longRun: 13.1 },
    ],
  },
];

export function MockPlan({
  palette,
  mode: _mode,
}: {
  palette: PaletteDefinition;
  mode: PaletteMode;
}) {
  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tight text-primary">
            Race Campaign
          </h2>
          <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-[0.2em] mt-0.5">
            5 Weeks to Race · Sep 14
          </p>
          <div className="flex items-center gap-2 mt-1.5">
            <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-destructive/15 text-destructive">
              <AlertTriangle className="h-2.5 w-2.5" /> 1 Missed
            </span>
            <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent/15 text-foreground">
              <Sparkles className="h-2.5 w-2.5" /> 1 Edited
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-primary/5 border border-primary/20 rounded-md p-3 flex items-center gap-3">
          <CalendarDays className="h-6 w-6 text-primary shrink-0" />
          <div>
            <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
              Current Week
            </div>
            <div className="text-lg font-black">Week 9</div>
          </div>
        </div>
        <div
          className="bg-card border border-card-border rounded-md p-3 flex items-center gap-3 border-l-4"
          style={{ borderLeftColor: palette.phaseColors.tempo }}
        >
          <Activity
            className="h-6 w-6 shrink-0"
            style={{ color: palette.phaseColors.tempo }}
          />
          <div>
            <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
              Phase
            </div>
            <div className="text-lg font-black">Tempo/Threshold</div>
          </div>
        </div>
        <div className="bg-card border border-card-border rounded-md p-3 flex items-center gap-3">
          <Target className="h-6 w-6 text-muted-foreground shrink-0" />
          <div>
            <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
              Target Miles
            </div>
            <div className="text-lg font-black">32 mi</div>
          </div>
        </div>
      </div>

      <div className="space-y-5">
        {PHASES.map((phase) => {
          const color = palette.phaseColors[phase.key];
          return (
            <div key={phase.label} className="space-y-2.5">
              <h3
                className="text-sm font-black uppercase tracking-wider border-b-2 pb-1.5 flex items-center gap-2"
                style={{ borderBottomColor: color }}
              >
                <span
                  className="h-3 w-1.5 rounded-sm shrink-0"
                  style={{ backgroundColor: color }}
                />
                {phase.label}
              </h3>
              <div className="grid grid-cols-3 gap-2.5">
                {phase.weeks.map((week) => {
                  const pct = week.planned
                    ? Math.min(100, (week.miles / week.planned) * 100)
                    : 0;
                  return (
                    <div
                      key={week.week}
                      className={
                        "border border-card-border bg-card rounded-md p-2.5 border-l-4 " +
                        (week.active ? "ring-2 ring-primary bg-primary/5" : "")
                      }
                      style={{ borderLeftColor: color }}
                    >
                      <div className="flex items-baseline justify-between">
                        <div className="font-black text-sm">W{week.week}</div>
                        {week.active && (
                          <span className="text-[8px] bg-primary text-primary-foreground px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">
                            Active
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-1.5">
                        {week.miles} / {week.planned} mi
                      </div>
                      <div className="h-1 bg-muted rounded mt-1 overflow-hidden">
                        <div
                          className="h-full"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: color,
                          }}
                        />
                      </div>
                      <div className="flex items-center justify-between mt-2">
                        <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                          Long {week.longRun}mi
                        </div>
                        <div className="flex gap-1">
                          {week.edited ? (
                            <span className="text-[8px] font-bold uppercase tracking-wider px-1 py-0.5 rounded bg-accent/15 text-foreground flex items-center gap-0.5">
                              <Sparkles className="h-2 w-2" />
                            </span>
                          ) : null}
                          {week.missed ? (
                            <span className="text-[8px] font-bold uppercase tracking-wider px-1 py-0.5 rounded bg-destructive/15 text-destructive flex items-center gap-0.5">
                              <AlertTriangle className="h-2 w-2" />
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
