import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SectionHeader } from "./section-header";
import { EmptyState } from "./empty-state";
import { CoachNote } from "./coach-note";
import { StatReadout } from "./stat-readout";
import { MetricRing } from "./metric-ring";
import { TrendArea } from "./trend-area";

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

  it("StatReadout shows the mono value and unit", () => {
    render(<StatReadout label="Weight" value={280} unit="lb" />);
    expect(screen.getByText("280")).toBeTruthy();
    expect(screen.getByText("lb")).toBeTruthy();
  });

  it("MetricRing shows the center value", () => {
    render(<MetricRing value={1430} goal={2480} unit="kcal" label="Calories" />);
    expect(screen.getByText("1430")).toBeTruthy();
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
