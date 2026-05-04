import { hslToHex } from "./hsl";
import type { PaletteDefinition, PaletteMode } from "./palettes";
import { PHASE_DISPLAY, PHASE_LABELS } from "./palettes";

interface SwatchProps {
  label: string;
  hsl: string;
  textOnDark?: boolean;
}

function Swatch({ label, hsl, textOnDark }: SwatchProps) {
  const hex = hslToHex(hsl);
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div
        className="h-7 w-7 rounded shrink-0 ring-1 ring-black/10 dark:ring-white/10"
        style={{ backgroundColor: `hsl(${hsl})` }}
      />
      <div className="min-w-0">
        <div
          className="text-[10px] uppercase font-bold tracking-wider truncate"
          style={{ color: textOnDark ? "rgba(255,255,255,.85)" : "inherit" }}
        >
          {label}
        </div>
        <div
          className="text-[9px] font-mono leading-tight truncate"
          style={{
            color: textOnDark ? "rgba(255,255,255,.55)" : "rgba(0,0,0,.55)",
          }}
        >
          {hex}
        </div>
        <div
          className="text-[9px] font-mono leading-tight truncate"
          style={{
            color: textOnDark ? "rgba(255,255,255,.40)" : "rgba(0,0,0,.40)",
          }}
        >
          {hsl}
        </div>
      </div>
    </div>
  );
}

interface PaletteStripProps {
  palette: PaletteDefinition;
  mode: PaletteMode;
  onToggleMode: () => void;
}

export function PaletteStrip({ palette, mode, onToggleMode }: PaletteStripProps) {
  const tokens = palette[mode];
  const isDark = mode === "dark";
  const stripBg = isDark ? "rgb(20 20 22)" : "rgb(248 248 250)";
  const stripFg = isDark ? "rgb(240 240 245)" : "rgb(20 20 22)";
  const stripBorder = isDark ? "rgba(255,255,255,.08)" : "rgba(0,0,0,.08)";

  const coreSwatches: Array<{ label: string; hsl: string }> = [
    { label: "Background", hsl: tokens.background },
    { label: "Surface", hsl: tokens.card },
    { label: "Sidebar", hsl: tokens.sidebar },
    { label: "Primary", hsl: tokens.primary },
    { label: "Accent", hsl: tokens.accent },
    { label: "Muted", hsl: tokens.muted },
    { label: "Destructive", hsl: tokens.destructive },
  ];

  const chartSwatches: Array<{ label: string; hsl: string }> = [
    { label: "Chart 1", hsl: tokens.chart1 },
    { label: "Chart 2", hsl: tokens.chart2 },
    { label: "Chart 3", hsl: tokens.chart3 },
    { label: "Chart 4", hsl: tokens.chart4 },
    { label: "Chart 5", hsl: tokens.chart5 },
  ];

  return (
    <div
      className="border-b px-5 py-4 space-y-3"
      style={{
        backgroundColor: stripBg,
        color: stripFg,
        borderColor: stripBorder,
      }}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div
            className="text-[10px] uppercase font-bold tracking-[0.2em]"
            style={{ color: isDark ? "rgba(255,255,255,.55)" : "rgba(0,0,0,.55)" }}
          >
            Palette {palette.number}
          </div>
          <h1 className="text-xl font-black tracking-tight uppercase leading-tight">
            {palette.name}
          </h1>
          <p
            className="text-xs mt-0.5"
            style={{ color: isDark ? "rgba(255,255,255,.65)" : "rgba(0,0,0,.65)" }}
          >
            {palette.tagline}
          </p>
        </div>
        <button
          type="button"
          onClick={onToggleMode}
          data-testid={`button-toggle-mode-${palette.key}`}
          className="text-[10px] uppercase font-bold tracking-wider px-3 py-1.5 rounded ring-1 transition-colors"
          style={{
            backgroundColor: isDark ? "rgba(255,255,255,.08)" : "rgba(0,0,0,.06)",
            color: stripFg,
            borderColor: stripBorder,
          }}
        >
          Mode: {mode === "light" ? "Light" : "Dark"} · click to flip
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-x-3 gap-y-2">
        {coreSwatches.map((s) => (
          <Swatch key={s.label} label={s.label} hsl={s.hsl} textOnDark={isDark} />
        ))}
      </div>

      <div className="space-y-1.5 pt-1">
        <div
          className="text-[9px] uppercase font-bold tracking-[0.18em]"
          style={{ color: isDark ? "rgba(255,255,255,.5)" : "rgba(0,0,0,.5)" }}
        >
          Chart Ramp
        </div>
        <div className="grid grid-cols-5 gap-x-3 gap-y-2">
          {chartSwatches.map((s) => (
            <Swatch key={s.label} label={s.label} hsl={s.hsl} textOnDark={isDark} />
          ))}
        </div>
      </div>

      <div className="space-y-1.5 pt-1">
        <div
          className="text-[9px] uppercase font-bold tracking-[0.18em]"
          style={{ color: isDark ? "rgba(255,255,255,.5)" : "rgba(0,0,0,.5)" }}
        >
          Phase Colors
        </div>
        <div className="flex flex-wrap gap-2">
          {PHASE_LABELS.map((p) => {
            const c = palette.phaseColors[p];
            return (
              <div
                key={p}
                className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded"
                style={{
                  backgroundColor: isDark
                    ? "rgba(255,255,255,.06)"
                    : "rgba(0,0,0,.04)",
                  color: stripFg,
                }}
              >
                <span
                  className="h-2.5 w-2.5 rounded-sm"
                  style={{ backgroundColor: c }}
                />
                {PHASE_DISPLAY[p]}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
