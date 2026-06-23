// US Navy body-fat estimate from tape measurements. Pure + dependency-free so
// it's unit-testable. The runner tapes neck + waist (+ hip for women); combined
// with height + sex (from Goals), this gives a body-fat % without a smart scale
// or DEXA — repeatable and free. Accuracy is "good trend, rough absolute," which
// is exactly what the recomp read wants (judge the direction, not the decimal).
//
// Men:   %BF = 86.010·log10(waist − neck) − 70.041·log10(height) + 36.76
// Women: %BF = 163.205·log10(waist + hip − neck) − 97.684·log10(height) − 78.387
// All circumferences + height in INCHES.

export type NavyInput = {
  sex: string | null; // "male" | "female"; defaults to male formula when unknown
  heightIn: number | null;
  neckIn: number | null;
  waistIn: number | null;
  hipIn?: number | null; // required for the women's formula only
};

const log10 = (n: number) => Math.log(n) / Math.LN10;
const round1 = (n: number) => Math.round(n * 10) / 10;

// Returns the estimated body-fat % (rounded to 0.1), or null when the inputs
// can't produce a valid estimate (missing measurement, non-positive log
// argument, or a female estimate without a hip measurement).
export function navyBodyFatPct(input: NavyInput): number | null {
  const { sex, heightIn, neckIn, waistIn } = input;
  if (heightIn == null || neckIn == null || waistIn == null) return null;
  if (heightIn <= 0 || neckIn <= 0 || waistIn <= 0) return null;

  let pct: number;
  if (sex === "female") {
    const hipIn = input.hipIn;
    if (hipIn == null || hipIn <= 0) return null; // women's formula needs hip
    const inner = waistIn + hipIn - neckIn;
    if (inner <= 0) return null;
    pct = 163.205 * log10(inner) - 97.684 * log10(heightIn) - 78.387;
  } else {
    const inner = waistIn - neckIn;
    if (inner <= 0) return null; // waist must exceed neck
    pct = 86.01 * log10(inner) - 70.041 * log10(heightIn) + 36.76;
  }

  if (!Number.isFinite(pct)) return null;
  // Clamp to a sane human range so a fat-fingered tape entry can't store a wild %.
  if (pct < 3 || pct > 65) return null;
  return round1(pct);
}
