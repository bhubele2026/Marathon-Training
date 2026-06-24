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

// When the day's work was met but through a different modality mix than the
// plan asked for (e.g. a lift + a run instead of the prescribed bike+row), the
// coach acknowledges the substitution instead of grading it. Same warm/success
// tone family as "complete"/"over".
const SUBSTITUTED_HEADLINE = "Did the work";
const SUBSTITUTED_LINES = [
  "Not the session on the card, but you matched the work — your way. I'll take graft in any flavour.",
  "Swapped the plan for your own mix and still hit the load. Resourceful little grafter. Allowed.",
  "Different shape, same effort banked. The plan's a guide, not a cage — well played.",
];

/**
 * The coach's verdict on a whole DAY, judged on training LOAD (which already
 * weights modalities) as the primary signal, with raw minutes as a generous
 * secondary band — so meeting EITHER the weighted load OR the minute volume
 * counts, and a small minute delta with met load is never a shortfall. A lift +
 * a run that together cover a conditioning day read as ONE met day, not two
 * punished fragments. When `substituted` is set and the day is met, the verdict
 * flips to a "you did the work, just your way" acknowledgement.
 */
export function dayVerdict(input: {
  plannedLoad: number | null | undefined;
  actualLoad: number | null | undefined;
  plannedMin: number | null | undefined;
  actualMin: number | null | undefined;
  substituted?: boolean;
  seed?: number;
}): SessionVerdict | null {
  const plannedLoad = Math.max(0, input.plannedLoad ?? 0);
  const actualLoad = Math.max(0, input.actualLoad ?? 0);
  const plannedMin = Math.max(0, input.plannedMin ?? 0);
  const actualMin = Math.max(0, input.actualMin ?? 0);
  const seed = input.seed ?? 0;

  // Nothing planned and nothing done.
  if (plannedLoad <= 0 && plannedMin <= 0 && actualLoad <= 0 && actualMin <= 0) {
    return null;
  }
  // Trained with nothing prescribed → a bonus.
  if (plannedLoad <= 0 && plannedMin <= 0) {
    return { bucket: "bonus", headline: HEADLINES.bonus, line: pick("bonus", seed), ratio: null };
  }
  // Planned but nothing logged.
  if (actualLoad <= 0 && actualMin <= 0) {
    return { bucket: "skipped", headline: HEADLINES.skipped, line: pick("skipped", seed), ratio: 0 };
  }

  // Load is primary; minutes are the band. Meeting either counts, so a slightly
  // lighter-weighted-but-equal-volume day isn't dinged.
  const loadRatio = plannedLoad > 0 ? actualLoad / plannedLoad : 0;
  const minuteRatio = plannedMin > 0 ? actualMin / plannedMin : 0;
  const ratio = Math.max(loadRatio, minuteRatio);

  let bucket: VerdictBucket;
  if (ratio > 1.15) bucket = "over";
  else if (ratio >= 0.9) bucket = "complete";
  else if (ratio >= 0.6) bucket = "close";
  else bucket = "short";

  // Substitution acknowledgement only when the day was actually met (not when
  // they fell short) — keep the success tone via the "complete" bucket.
  if (input.substituted && (bucket === "over" || bucket === "complete" || bucket === "close")) {
    return {
      bucket: "complete",
      headline: SUBSTITUTED_HEADLINE,
      line: SUBSTITUTED_LINES[Math.abs(seed) % SUBSTITUTED_LINES.length]!,
      ratio,
    };
  }

  return { bucket, headline: HEADLINES[bucket], line: pick(bucket, seed), ratio };
}
