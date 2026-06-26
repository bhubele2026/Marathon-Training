import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { NutritionInsight } from "@/components/insights/types";
import { BulletMetric } from "@/components/insights/bullet-metric";
import { AdherenceDots } from "@/components/insights/adherence-dots";
import { TargetGauge } from "@/components/insights/target-gauge";
import { InsightCard } from "@/components/insights/insight-card";

function protein(over: Partial<NutritionInsight> = {}): NutritionInsight {
  return {
    id: "protein",
    label: "Protein",
    group: "macros",
    unit: "g",
    actual: 197,
    target: 224,
    floor: 192,
    direction: "higher_better",
    series: [
      { date: "2026-06-23", value: 210 },
      { date: "2026-06-24", value: 188 },
      { date: "2026-06-25", value: 201 },
    ],
    goal: 224,
    daysLogged: 7,
    daysHit: 3,
    perDay: [
      { date: "2026-06-23", hit: "hit" },
      { date: "2026-06-24", hit: "miss" },
      { date: "2026-06-25", hit: "close" },
    ],
    status: "attention",
    caption: "197 g/day — under the 224 target.",
    detail: "Anchor a protein serving at each meal to close the gap.",
    ...over,
  };
}

describe("BulletMetric", () => {
  it("renders a bar for a logged metric", () => {
    render(<BulletMetric insight={protein()} />);
    expect(screen.getByTestId("bullet-protein")).toBeTruthy();
    expect(screen.getByText(/target 224 g/)).toBeTruthy();
  });

  it("shows a calm placeholder when nothing is logged", () => {
    render(<BulletMetric insight={protein({ actual: null })} />);
    expect(screen.getByText(/not logged yet/i)).toBeTruthy();
  });

  it("renders band-direction metrics without throwing", () => {
    const sodium = protein({
      id: "sodium",
      label: "Sodium",
      unit: "mg",
      actual: 2800,
      target: 2300,
      floor: 1495,
      ceiling: 2300,
      direction: "band",
      status: "appropriate",
    });
    render(<BulletMetric insight={sodium} />);
    expect(screen.getByTestId("bullet-sodium")).toBeTruthy();
  });
});

describe("AdherenceDots", () => {
  it("renders one dot per logged day", () => {
    const { container } = render(<AdherenceDots perDay={protein().perDay} />);
    expect(screen.getByTestId("adherence-dots")).toBeTruthy();
    expect(container.querySelectorAll("[title]").length).toBe(3);
  });

  it("renders nothing with no data", () => {
    const { container } = render(<AdherenceDots perDay={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("TargetGauge", () => {
  it("captions days on target", () => {
    render(<TargetGauge daysHit={3} daysLogged={7} />);
    expect(screen.getByText(/3 of 7 days/)).toBeTruthy();
  });

  it("handles no logged days", () => {
    render(<TargetGauge daysHit={0} daysLogged={0} />);
    expect(screen.getByText(/no logged days/i)).toBeTruthy();
  });
});

describe("InsightCard", () => {
  it("shows the label, caption and a toggling why", () => {
    render(
      <InsightCard insight={protein()}>
        <BulletMetric insight={protein()} showHeader={false} />
      </InsightCard>,
    );
    expect(screen.getByTestId("insight-card-protein")).toBeTruthy();
    expect(screen.getByText("197 g/day — under the 224 target.")).toBeTruthy();
    // Detail hidden until "Why" is tapped.
    expect(screen.queryByText(/anchor a protein serving/i)).toBeNull();
    fireEvent.click(screen.getByTestId("insight-why-protein"));
    expect(screen.getByText(/anchor a protein serving/i)).toBeTruthy();
  });
});
