import Anthropic from "@anthropic-ai/sdk";

// Thin wrapper around the official Anthropic SDK. Keeps key handling + model
// choice in one place so routes don't each reconstruct a client. The key lives
// in ANTHROPIC_API_KEY (a Replit secret) and never reaches the browser — all
// calls happen server-side.

/** Default model for plan authoring. Opus is the most capable tier. */
export const MODEL = "claude-opus-4-8";

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
      "ANTHROPIC_API_KEY is not set. Add it as a Replit secret (Tools → Secrets) " +
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
