import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Activity, Dumbbell } from "lucide-react";
import { SectionHeader } from "./section-header";
import { EmptyState } from "./empty-state";
import { CoachNote } from "./coach-note";
import { StatReadout } from "./stat-readout";
import { StatTile } from "./stat-tile";
import { MetricRing } from "./metric-ring";
import { TrendArea } from "./trend-area";
import { FeatureTile } from "./feature-tile";
import { SegmentedControl } from "./segmented-control";
import { ActivityCalendar } from "./activity-calendar";
import { WaterTracker } from "./water-tracker";
import { GoalArc } from "./goal-arc";

// Light render coverage for the studio component kit — each renders without
// crashing and surfaces its key content. TrendArea is exercised via its sparse
// fallback path so the test doesn't depend on Recharts measuring in jsdom.
afterEach(cleanup);

describe("studio component kit", () => {
  it("SectionHeader shows the eyebrow", () => {
    render(<SectionHeader eyebrow="Today" />);
    expect(screen.getByText("Today")).toBeTruthy();
  });

  it("EmptyState renders the full (unclipped) hint", () => {
    render(
      <EmptyState
        title="No fuelling read yet"
        hint="Close a day or two and I can read your fuelling."
      />,
    );
    expect(screen.getByText(/read your fuelling/)).toBeTruthy();
  });

  it("CoachNote renders the line and a status pill", () => {
    render(<CoachNote status="SO CLOSE">Respectable-ish.</CoachNote>);
    expect(screen.getByText("Respectable-ish.")).toBeTruthy();
    expect(screen.getByText("SO CLOSE")).toBeTruthy();
  });

  it("StatReadout shows the display value and unit", () => {
    render(<StatReadout label="Weight" value={280} unit="lb" />);
    expect(screen.getByText("280")).toBeTruthy();
    expect(screen.getByText("lb")).toBeTruthy();
  });

  it("StatTile wraps a readout and shows its value", () => {
    render(<StatTile label="Streak" value={12} unit="days" icon={Dumbbell} />);
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("Streak")).toBeTruthy();
  });

  it("MetricRing shows the center value (and renders with macro arcs)", () => {
    render(
      <MetricRing
        value={1430}
        goal={2480}
        unit="kcal"
        label="Calories"
        hero
        macros={[
          { value: 120, goal: 180, color: "hsl(var(--chart-2))", label: "Protein" },
          { value: 140, goal: 220, color: "hsl(var(--chart-3))", label: "Carbs" },
        ]}
      />,
    );
    expect(screen.getByText("1430")).toBeTruthy();
  });

  it("MetricRing draws the pace marker only when paceMarker is set", () => {
    const { rerender } = render(
      <MetricRing value={1430} goal={2480} unit="kcal" label="Calories" hero />,
    );
    // Purely additive: no marker without the prop.
    expect(screen.queryByTestId("metric-ring-pace-marker")).toBeNull();
    rerender(
      <MetricRing value={1430} goal={2480} unit="kcal" label="Calories" hero paceMarker={0.46} />,
    );
    expect(screen.getByTestId("metric-ring-pace-marker")).toBeTruthy();
  });

  it("FeatureTile fires onClick and shows label + stat", () => {
    const onClick = vi.fn();
    render(<FeatureTile icon={Activity} label="Nutrition" stat="1,820 kcal" onClick={onClick} />);
    expect(screen.getByText("Nutrition")).toBeTruthy();
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("SegmentedControl marks the active option and fires onChange", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        ariaLabel="Range"
        value="W"
        onChange={onChange}
        options={[
          { value: "D", label: "Daily" },
          { value: "W", label: "Weekly" },
          { value: "M", label: "Monthly" },
        ]}
      />,
    );
    const weekly = screen.getByRole("radio", { name: "Weekly" });
    expect(weekly.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Monthly" }));
    expect(onChange).toHaveBeenCalledWith("M");
  });

  it("ActivityCalendar renders the day grid and footer stats", () => {
    render(
      <ActivityCalendar
        days={[
          { date: "2026-06-01", level: 2 },
          { date: "2026-06-02", level: 0 },
          { date: "2026-06-03", level: 1 },
        ]}
        stats={{ activeDays: 18, vsLast30: 3, streak: 4 }}
      />,
    );
    expect(screen.getByText("18")).toBeTruthy();
    expect(screen.getByText("Streak")).toBeTruthy();
    expect(screen.getByText("+3")).toBeTruthy();
  });

  it("ActivityCalendar reveals a day's workout(s) on tap (focusable button)", () => {
    render(
      <ActivityCalendar
        days={[
          {
            date: "2026-06-01",
            level: 2,
            workouts: [{ label: "Lower Strength", detail: "Tonal · 42 min" }],
          },
          { date: "2026-06-02", level: 0 },
        ]}
      />,
    );
    // Rest day stays a plain dot; the active day is a focusable button.
    const trigger = screen.getByTestId("activity-day-2026-06-01");
    expect(trigger.tagName).toBe("BUTTON");
    fireEvent.click(trigger);
    expect(screen.getAllByText("Lower Strength").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Tonal · 42 min/).length).toBeGreaterThan(0);
  });

  it("WaterTracker shows the day total and a goal-met cheer", () => {
    render(<WaterTracker oz={80} goalOz={72} />);
    expect(screen.getByText(/2\.\d{2} L/)).toBeTruthy();
    expect(screen.getByText("Well done")).toBeTruthy();
  });

  it("GoalArc renders the percentage", () => {
    render(<GoalArc value={0.62} label="Goal progress" />);
    expect(screen.getByText("62%")).toBeTruthy();
  });

  it("TrendArea renders the sparse fallback with <2 points", () => {
    render(
      <TrendArea
        data={[{ d: "Mon", v: 280 }]}
        xKey="d"
        yKey="v"
        sparseFallback={<div>One weigh-in down. Two more and your trend shows up.</div>}
      />,
    );
    expect(screen.getByText(/One weigh-in down/)).toBeTruthy();
  });
});
