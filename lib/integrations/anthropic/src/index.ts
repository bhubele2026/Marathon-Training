import Anthropic from "@anthropic-ai/sdk";

// Thin wrapper around the official Anthropic SDK. Keeps key handling + model
// choice in one place so routes don't each reconstruct a client. The key lives
// in the ANTHROPIC_API_KEY env var and never reaches the browser — all
// calls happen server-side.

/** THE BRAIN. Fable 5 — Anthropic's most capable model — everywhere, so every
 * aspect of the app (plan authoring, nutrition, coaching, progress) reasons at
 * the top tier. Fable 5 notes: thinking is always on (never pass
 * `thinking:{disabled}` or `budget_tokens` — control depth with
 * `output_config.effort`); pair calls with a refusal fallback to Opus 4.8 so a
 * safety decline never dead-ends; org must have 30-day data retention. Fable 5
 * is premium ($10/$50 per 1M) — swap this one line back to `claude-opus-4-8` to
 * dial cost. */
export const MODEL = "claude-fable-5";

/** Fallback model when a Fable 5 call is declined by safety classifiers (wire
 * with the `server-side-fallback-2026-06-01` beta + `fallbacks` where used). */
export const FALLBACK_MODEL = "claude-opus-4-8";

/**
 * Per his ask ("huge brain, all aspects, smarter than me"), the lighter
 * narrative surfaces (nutritionist / coach / week-review / progress) run on
 * Fable 5 too — no downgrade. Kept as a separate export so it can be dialed to a
 * cheaper tier later if latency/cost demands, without touching call sites.
 */
export const FAST_MODEL = "claude-fable-5";

/** True when ANTHROPIC_API_KEY is present, so callers can 400 with a clear hint. */
export function isConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let cached: Anthropic | null = null;

/**
 * Get a singleton Anthropic client. Throws a clear error if the key is missing
 * rather than letting the SDK fail deeper with a vaguer message.
 */
export function getAnthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Set it in the environment " +
        "to enable the Claude plan builder.",
    );
  }
  if (!cached) {
    cached = new Anthropic();
  }
  return cached;
}

// Re-export the class (which also carries the type namespace, e.g.
// `Anthropic.MessageParam`, `Anthropic.Tool`) so callers import from one place.
export { Anthropic };
