import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DialGauge } from "@/components/insights/dial-gauge";

afterEach(cleanup);

describe("DialGauge", () => {
  it("renders the track, needle and labels for a normal value", () => {
    render(
      <DialGauge
        pct={0.88}
        bandLo={0.35}
        bandHi={0.55}
        status="appropriate"
        lowLabel="2.3k"
        highLabel="3.5k+"
      />,
    );
    expect(screen.getByTestId("dial-gauge")).toBeTruthy();
    expect(screen.getByTestId("dial-gauge-needle")).toBeTruthy();
    expect(screen.getByText("2.3k")).toBeTruthy();
    expect(screen.getByText("3.5k+")).toBeTruthy();
  });

  it("renders without throwing for a sparse/degenerate band", () => {
    render(<DialGauge pct={0} bandLo={0.5} bandHi={0.5} status="early" />);
    expect(screen.getByTestId("dial-gauge")).toBeTruthy();
    expect(screen.getByTestId("dial-gauge-needle")).toBeTruthy();
  });
});
