// The coach's verdict on a LOGGED session vs what the plan asked for. Pure +
// client-side: the planned/actual minutes are already on the Today page, so we
// don't need a round-trip or an AI call per card. Copy is in the shared coach
// voice (sardonic British tough-love, mean about the EFFORT never the person —
// see lib/plan-knowledge/persona.ts) so the verdict reads like the same coach
// who writes the daily line.
//
// Buckets by actual/planned minute ratio:
//   over     — did noticeably more than asked ("you did so much more")
//   complete — did the lot ("good job, you did it all")
//   close    — nearly there ("you were close")
//   short    — well under the plan (the cheeky "you suck")
//   skipped  — planned but nothing logged
//   bonus    — trained with nothing on the plan (off-plan extra)

export type VerdictBucket =
  | "over"
  | "complete"
  | "close"
  | "short"
  | "skipped"
  | "bonus";

export type SessionVerdict = {
  bucket: VerdictBucket;
  headline: string;
  line: string;
  /** Ratio of actual to planned minutes (null for skipped/bonus). */
  ratio: number | null;
};

// Sardonic-British phrase banks. Praise is brief and a bit grudging; the ribbing
// is aimed at the effort, never the person. Multiple variants so the same bucket
// doesn't read identically on every card — a stable seed (the workout id) picks
// one so it doesn't reshuffle on every render.
const LINES: Record<VerdictBucket, string[]> = {
  over: [
    "Blew clean past the plan and kept going. Showing off — and I'm into it. Don't you dare ruin it.",
    "Did far more than asked. Steady on, hero, you'll put the rest of us out of a job. Magnificent.",
    "Smashed the target into next week. Actual grafting. Suspicious behaviour, but I'll allow it.",
  ],
  complete: [
    "Did the absolute lot. Gold star. Don't let it go to your head — there's a tomorrow, you know.",
    "Every minute done, plan followed like a grown adult. Lovely. Frankly astonishing.",
    "Nailed it. Textbook. I'm impressed, and you know exactly what that costs me to admit.",
  ],
  close: [
    "Close enough to smell it — a smidge short, but you turned up, so I'll allow it. Just.",
    "Nearly the full set. Nearly, love. It's the last bit that counts and you know it.",
    "A whisker under the plan, but you showed your face and did the work. Respectable-ish.",
  ],
  short: [
    "That was a warm-up wearing a workout's coat and a fake moustache. Miles off, that.",
    "Blink and you'd have missed it. The plan's over there, pointing and laughing at you.",
    "Half a session and a full excuse. Magnificent. Give me the real thing tomorrow, eh?",
  ],
  skipped: [
    "Planned and ghosted. The sofa won again, did it? Bold strategy. Cowardly, but bold.",
    "The session sat there, all dressed up, waiting by the door. You never turned up. Tragic.",
  ],
  bonus: [
    "Nothing on the plan and you trained anyway. Teacher's pet. Absolutely love to see it.",
    "Off-script and grafting while nobody's watching. That's the real stuff. Cracking.",
  ],
};

function pick(bucket: VerdictBucket, seed: number): string {
  const bank = LINES[bucket];
  return bank[Math.abs(seed) % bank.length]!;
}

const HEADLINES: Record<VerdictBucket, string> = {
  over: "Overdelivered",
  complete: "Nailed it",
  close: "So close",
  short: "Fell short",
  skipped: "Skipped",
  bonus: "Bonus",
};

export function sessionVerdict(input: {
  plannedMin: number | null | undefined;
  actualMin: number | null | undefined;
  /** Stable seed (e.g. the workout id) so the variant doesn't reshuffle. */
  seed?: number;
}): SessionVerdict | null {
  const planned = Math.max(0, input.plannedMin ?? 0);
  const actual = Math.max(0, input.actualMin ?? 0);
  const seed = input.seed ?? 0;

  // Nothing to judge.
  if (planned <= 0 && actual <= 0) return null;

  // Trained with nothing prescribed → a bonus, not graded against a plan.
  if (planned <= 0 && actual > 0) {
    return { bucket: "bonus", headline: HEADLINES.bonus, line: pick("bonus", seed), ratio: null };
  }
  // Planned but nothing done.
  if (actual <= 0) {
    return { bucket: "skipped", headline: HEADLINES.skipped, line: pick("skipped", seed), ratio: 0 };
  }

  const ratio = actual / planned;
  let bucket: VerdictBucket;
  if (ratio > 1.15) bucket = "over";
  else if (ratio >= 0.9) bucket = "complete";
  else if (ratio >= 0.6) bucket = "close";
  else bucket = "short";

  return { bucket, headline: HEADLINES[bucket], line: pick(bucket, seed), ratio };
}
