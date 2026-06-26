import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { BandBar } from "@/components/insights/band-bar";

afterEach(cleanup);

describe("BandBar", () => {
  it("renders the actual/target readout and the marker for a logged day", () => {
    render(
      <BandBar
        actual={2479}
        target={2400}
        floor={1500}
        ceiling={2600}
        status="over"
        unit="kcal"
      />,
    );
    expect(screen.getByTestId("band-bar")).toBeTruthy();
    expect(screen.getByTestId("band-bar-marker")).toBeTruthy();
    expect(screen.getByText("2,479")).toBeTruthy();
    expect(screen.getByText(/2,400 kcal/)).toBeTruthy();
  });

  it("shows a calm placeholder and no marker when nothing is logged", () => {
    render(<BandBar actual={null} target={2400} floor={1500} status="early" />);
    expect(screen.getByTestId("band-bar")).toBeTruthy();
    expect(screen.queryByTestId("band-bar-marker")).toBeNull();
    expect(screen.getByText(/not logged yet/i)).toBeTruthy();
  });
});
