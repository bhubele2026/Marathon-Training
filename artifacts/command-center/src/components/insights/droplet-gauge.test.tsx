import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DropletGauge } from "@/components/insights/droplet-gauge";

afterEach(cleanup);

describe("DropletGauge", () => {
  it("renders the value and a fill for a logged level", () => {
    const { container } = render(<DropletGauge pct={0.44} value={44} />);
    expect(screen.getByTestId("droplet-gauge")).toBeTruthy();
    expect(screen.getByText("44")).toBeTruthy();
    expect(container.querySelector("rect")).toBeTruthy();
  });

  it("renders an empty droplet (no fill) when value is null", () => {
    const { container } = render(<DropletGauge pct={0} value={null} />);
    expect(screen.getByTestId("droplet-gauge")).toBeTruthy();
    expect(container.querySelector("rect")).toBeNull();
  });

  it("uses a unique clip id per instance so droplets don't collide", () => {
    const { container } = render(
      <div>
        <DropletGauge pct={0.3} value={30} />
        <DropletGauge pct={0.7} value={70} />
      </div>,
    );
    const ids = Array.from(container.querySelectorAll("clipPath")).map((n) =>
      n.getAttribute("id"),
    );
    expect(ids.length).toBe(2);
    expect(ids[0]).not.toBe(ids[1]);
  });
});
