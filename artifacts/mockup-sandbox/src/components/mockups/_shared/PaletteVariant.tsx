import { useState, type CSSProperties } from "react";
import { MockDashboard } from "./MockDashboard";
import { MockPlan } from "./MockPlan";
import { MockSidebar } from "./MockSidebar";
import { MockToday } from "./MockToday";
import { PaletteStrip } from "./PaletteStrip";
import {
  PALETTES,
  type PaletteDefinition,
  type PaletteMode,
  type PaletteTokens,
} from "./palettes";

function tokensToCss(tokens: PaletteTokens): CSSProperties {
  return {
    "--background": tokens.background,
    "--foreground": tokens.foreground,
    "--border": tokens.border,
    "--card": tokens.card,
    "--card-foreground": tokens.cardForeground,
    "--card-border": tokens.cardBorder,
    "--sidebar": tokens.sidebar,
    "--sidebar-foreground": tokens.sidebarForeground,
    "--sidebar-border": tokens.sidebarBorder,
    "--sidebar-primary": tokens.sidebarPrimary,
    "--sidebar-primary-foreground": tokens.sidebarPrimaryForeground,
    "--sidebar-accent": tokens.sidebarAccent,
    "--sidebar-accent-foreground": tokens.sidebarAccentForeground,
    "--sidebar-ring": tokens.sidebarRing,
    "--popover": tokens.popover,
    "--popover-foreground": tokens.popoverForeground,
    "--popover-border": tokens.popoverBorder,
    "--primary": tokens.primary,
    "--primary-foreground": tokens.primaryForeground,
    "--secondary": tokens.secondary,
    "--secondary-foreground": tokens.secondaryForeground,
    "--muted": tokens.muted,
    "--muted-foreground": tokens.mutedForeground,
    "--accent": tokens.accent,
    "--accent-foreground": tokens.accentForeground,
    "--destructive": tokens.destructive,
    "--destructive-foreground": tokens.destructiveForeground,
    "--input": tokens.input,
    "--ring": tokens.ring,
    "--brand-orange": tokens.brandOrange,
    "--brand-purple": tokens.brandPurple,
    "--chart-1": tokens.chart1,
    "--chart-2": tokens.chart2,
    "--chart-3": tokens.chart3,
    "--chart-4": tokens.chart4,
    "--chart-5": tokens.chart5,
  } as CSSProperties;
}

interface ScreenFrameProps {
  title: string;
  activePath: string;
  children: React.ReactNode;
}

function ScreenFrame({ title, activePath, children }: ScreenFrameProps) {
  return (
    <div className="border border-border rounded-md overflow-hidden bg-background shadow-sm">
      <div className="px-3 py-1.5 border-b border-border bg-muted/40 flex items-center gap-2">
        <div className="flex gap-1">
          <div className="h-2 w-2 rounded-full bg-destructive/60" />
          <div className="h-2 w-2 rounded-full bg-accent/60" />
          <div className="h-2 w-2 rounded-full bg-primary/60" />
        </div>
        <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
          {title}
        </div>
      </div>
      <div className="flex" style={{ minHeight: 480 }}>
        <MockSidebar activePath={activePath} />
        <main className="flex-1 p-4 overflow-hidden bg-background text-foreground">
          {children}
        </main>
      </div>
    </div>
  );
}

interface PaletteVariantProps {
  paletteKey: string;
  initialMode?: PaletteMode;
}

export function PaletteVariant({
  paletteKey,
  initialMode = "light",
}: PaletteVariantProps) {
  const palette: PaletteDefinition | undefined = PALETTES[paletteKey];
  const [mode, setMode] = useState<PaletteMode>(initialMode);

  if (!palette) {
    return (
      <pre style={{ padding: "2rem", color: "red" }}>
        Unknown palette: {paletteKey}
      </pre>
    );
  }

  const cssVars = tokensToCss(palette[mode]);
  const wrapperClass =
    "min-h-screen font-sans text-[13px] " + (mode === "dark" ? "dark" : "");

  return (
    <div
      className={wrapperClass}
      style={{
        ...cssVars,
        backgroundColor: `hsl(${palette[mode].background})`,
        color: `hsl(${palette[mode].foreground})`,
      }}
      data-testid={`palette-variant-${palette.key}`}
      data-mode={mode}
    >
      <PaletteStrip
        palette={palette}
        mode={mode}
        onToggleMode={() => setMode((m) => (m === "light" ? "dark" : "light"))}
      />

      <div className="bg-background text-foreground space-y-6 p-5">
        <ScreenFrame title="Dashboard / Command Center" activePath="/">
          <MockDashboard palette={palette} mode={mode} />
        </ScreenFrame>
        <ScreenFrame title="Today's Mission" activePath="/today">
          <MockToday palette={palette} mode={mode} />
        </ScreenFrame>
        <ScreenFrame title="Half Marathon Plan" activePath="/plan">
          <MockPlan palette={palette} mode={mode} />
        </ScreenFrame>
      </div>
    </div>
  );
}
