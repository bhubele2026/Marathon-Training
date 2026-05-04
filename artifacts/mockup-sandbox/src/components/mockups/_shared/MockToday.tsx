import {
  CheckCircle2,
  Edit,
  Pencil,
  Trash2,
  XCircle,
  Zap,
} from "lucide-react";
import type { PaletteDefinition, PaletteMode } from "./palettes";

export function MockToday({
  palette,
  mode: _mode,
}: {
  palette: PaletteDefinition;
  mode: PaletteMode;
}) {
  const phaseColor = palette.phaseColors.tempo;

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <div>
        <h2 className="text-2xl font-black uppercase tracking-tight text-primary">
          Today's Mission
        </h2>
        <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-[0.2em] mt-0.5">
          Wed Aug 14
        </p>
      </div>

      <div className="border border-primary/30 bg-primary/5 rounded-md">
        <div className="border-b border-border px-4 py-2.5 flex items-center justify-between">
          <div className="text-xs font-bold uppercase tracking-wider text-primary">
            Mission Brief
          </div>
          <span
            className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded"
            style={{
              backgroundColor: phaseColor + "22",
              color: phaseColor,
            }}
          >
            Tempo/Threshold
          </span>
        </div>
        <div className="p-4">
          <div className="bg-card border border-card-border rounded-md p-4">
            <div className="grid grid-cols-[1fr_auto] gap-4 items-start">
              <div className="space-y-3 min-w-0">
                <div>
                  <div className="font-black text-xl uppercase tracking-tight">
                    Tempo Run
                  </div>
                  <p className="text-sm text-foreground mt-1.5 leading-relaxed">
                    Ease into miles 1–2, then lock in 8:15/mi for 6 miles.
                    Cool down 1 mi easy.
                  </p>
                </div>

                <div className="flex items-baseline gap-2">
                  <div className="text-4xl font-black text-primary leading-none">
                    8.0
                  </div>
                  <div className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
                    Miles Planned
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  <span className="text-[10px] bg-secondary text-secondary-foreground px-2 py-0.5 rounded font-bold uppercase tracking-wider">
                    Treadmill
                  </span>
                  <span className="text-[10px] bg-secondary text-secondary-foreground px-2 py-0.5 rounded font-bold uppercase tracking-wider">
                    Tonal Lower
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-3 pt-2 border-t border-border">
                  <div>
                    <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                      Total Min
                    </div>
                    <div className="text-base font-black mt-0.5">82</div>
                  </div>
                  <div>
                    <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                      Pace
                    </div>
                    <div className="text-base font-black mt-0.5">8:15</div>
                  </div>
                  <div>
                    <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                      Total Load
                    </div>
                    <div className="text-base font-black mt-0.5">214</div>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2 shrink-0 border-l border-border pl-4 self-stretch justify-center w-44">
                <button className="bg-primary text-primary-foreground text-xs font-black uppercase tracking-widest py-2.5 rounded flex items-center justify-center gap-1.5">
                  <Zap className="h-3.5 w-3.5" /> Crushed It
                </button>
                <button className="bg-secondary text-secondary-foreground text-[11px] font-bold uppercase tracking-wider py-2 rounded flex items-center justify-center gap-1.5">
                  <Pencil className="h-3 w-3" /> Log Mission
                </button>
                <button
                  className="text-[11px] font-bold uppercase tracking-wider py-2 rounded flex items-center justify-center gap-1.5 ring-1 text-destructive"
                  style={{
                    borderColor: "hsl(var(--destructive) / 0.4)",
                  }}
                >
                  <XCircle className="h-3 w-3" /> Skipped
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="border border-border bg-card rounded-md">
        <div className="bg-muted/30 border-b border-border px-4 py-2.5 flex items-center justify-between">
          <div className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            Mission Accomplished
            <span className="text-[10px] bg-accent/20 text-accent-foreground px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ml-1.5">
              AM
            </span>
          </div>
          <div className="flex gap-1.5">
            <button className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 ring-1 ring-border rounded flex items-center gap-1">
              <Edit className="h-3 w-3" /> Edit
            </button>
            <button className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 bg-destructive text-destructive-foreground rounded flex items-center gap-1">
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>
        <div className="p-4">
          <div className="flex items-baseline gap-3">
            <div className="text-3xl font-black text-primary leading-none">
              7.8
            </div>
            <div className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
              Miles · vs 8.0 planned
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent/15 text-foreground ml-auto">
              98% Adherence
            </span>
          </div>
          <div className="grid grid-cols-4 gap-3 mt-3 pt-3 border-t border-border">
            <div>
              <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                Distance
              </div>
              <div className="text-sm font-black mt-0.5">7.8 mi</div>
            </div>
            <div>
              <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                Pace
              </div>
              <div className="text-sm font-black mt-0.5">8:18/mi</div>
            </div>
            <div>
              <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                RPE
              </div>
              <div className="text-sm font-black mt-0.5">7/10</div>
            </div>
            <div>
              <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                Load
              </div>
              <div className="text-sm font-black mt-0.5">208</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
