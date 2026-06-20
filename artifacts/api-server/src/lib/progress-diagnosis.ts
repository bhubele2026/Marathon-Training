// The "what's happening" diagnosis engine. Pure + DB-free so the decision
// framework is unit-testable. The route gathers the metrics (reusing the
// tracking aggregator, the weekly-weight math, and nutrition-safety) and calls
// `diagnose`; the coach voice narrates the top findings on top of this.
//
// The job here is to be USEFUL and HONEST first — lead with the real cause and a
// SAFE fix. Tone is the wrapper (set per finding), not the substance. Safety is
// hard: a finding can never recommend eating below the floor or losing faster
// than the safe rate.

export type DiagnosisTone = "supportive" | "sassy" | "neutral" | "positive";

export type Finding = {
  id: string;
  // Ordering weight — higher surfaces first. Health flags outrank everything.
  rank: number;
  tone: DiagnosisTone;
  title: string;
  cause: string;
  fix: string;
};

export type DiagnosisInput = {
  weeks: number;
  weeksElapsed: number; // weeks of data we actually have
  goalDirection: "loss" | "gain" | "maintain" | "none";
  // Weight
  weightChangeLb: number | null; // current - start over window (negative = loss)
  goalRateLbPerWk: number | null; // signed weekly target rate
  onTrack: boolean | null;
  varianceLb: number | null; // latest actual - this week's target (neg = ahead for loss)
  // Nutrition
  avgCalories: number | null;
  calorieTarget: number | null;
  avgProtein: number | null;
  proteinTarget: number | null;
  proteinHitRate: number | null; // 0..1
  // Training
  sessionsDone: number;
  plannedSessions: number;
  // Recomp signal
  inchesChange: number | null; // negative = inches lost
  // Safety
  safeFloorKcal: number;
  safeRateLbPerWk: number; // positive magnitude
};

export type Diagnosis = {
  headline: string; // one-line plain-language summary of the top finding
  findings: Finding[]; // ranked, most important first
};

function actualWeeklyRate(d: DiagnosisInput): number | null {
  if (d.weightChangeLb == null || d.weeksElapsed <= 0) return null;
  return d.weightChangeLb / d.weeksElapsed; // signed lb/wk
}

// True when the scale has barely moved relative to a loss/gain goal.
function scaleFlat(d: DiagnosisInput): boolean {
  const r = actualWeeklyRate(d);
  if (r == null) return false;
  return Math.abs(r) < 0.25;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function diagnose(d: DiagnosisInput): Diagnosis {
  const findings: Finding[] = [];
  const rate = actualWeeklyRate(d); // signed lb/wk
  const lossRate = rate != null ? -rate : null; // positive = losing
  const overTarget =
    d.avgCalories != null &&
    d.calorieTarget != null &&
    d.avgCalories > d.calorieTarget + 100;
  const underTarget =
    d.avgCalories != null &&
    d.calorieTarget != null &&
    d.avgCalories < d.calorieTarget - 100;
  const underFloor =
    d.avgCalories != null && d.avgCalories > 0 && d.avgCalories < d.safeFloorKcal;
  const lowProtein =
    (d.proteinHitRate != null && d.proteinHitRate < 0.6) ||
    (d.avgProtein != null &&
      d.proteinTarget != null &&
      d.avgProtein < d.proteinTarget * 0.85);
  const missedSessions =
    d.plannedSessions > 0 && d.sessionsDone / d.plannedSessions < 0.7;
  const inchesDown = d.inchesChange != null && d.inchesChange < -0.5;
  const losingTooFast =
    d.goalDirection === "loss" &&
    lossRate != null &&
    lossRate > d.safeRateLbPerWk + 0.3;

  // --- HEALTH FLAGS (highest rank, supportive tone, never a roast) ----------
  if (underFloor) {
    findings.push({
      id: "under-floor",
      rank: 100,
      tone: "supportive",
      title: "You're eating below your safe floor",
      cause: `Average intake (${d.avgCalories} kcal) is under your safe floor of ${d.safeFloorKcal} kcal. That's too little to recover from training or hold onto muscle.`,
      fix: `Bring calories up to at least ${d.safeFloorKcal} kcal, protein first. This isn't a willpower problem — under-fuelling stalls everything. If it's a pattern, talk to a doctor or dietitian.`,
    });
  }
  if (losingTooFast && !underFloor) {
    findings.push({
      id: "too-fast",
      rank: 95,
      tone: "supportive",
      title: "You're losing faster than is safe",
      cause: `You're dropping about ${round1(lossRate as number)} lb/wk — faster than the safe ${round1(d.safeRateLbPerWk)} lb/wk for your size${lowProtein ? ", and protein's been low" : ""}. Fast loss eats muscle and tanks recovery.`,
      fix: `Raise calories toward maintenance until you're back near ${round1(d.safeRateLbPerWk)} lb/wk${lowProtein ? ", and get protein back to target" : ""}. Slower is the point — it keeps the muscle.`,
    });
  }

  // --- RECOMP WINNING (positive) -------------------------------------------
  if (!underFloor && !losingTooFast && scaleFlat(d) && inchesDown) {
    findings.push({
      id: "recomp-working",
      rank: 80,
      tone: "positive",
      title: "The scale's flat but you're recomping",
      cause: `Weight's barely moved, but you're down ${Math.abs(d.inchesChange as number)} in on the tape. That's fat off and muscle on at the same time — the scale is the wrong ruler here.`,
      fix: `Stay the course. Keep protein high and keep showing up; judge this by the tape and your lifts, not the scale.`,
    });
  }

  // --- ADHERENCE PROBLEMS (sassy when it's clearly effort) ------------------
  if (!underFloor && scaleFlat(d) && overTarget && !inchesDown && d.goalDirection === "loss") {
    findings.push({
      id: "flat-over-target",
      rank: 70,
      tone: "sassy",
      title: "Scale's flat because intake's over target",
      cause: `You're averaging ${d.avgCalories} kcal against a ${d.calorieTarget} target — about ${(d.avgCalories as number) - (d.calorieTarget as number)} over, every day. Maths doesn't negotiate.`,
      fix: `Tighten intake back to target (or sanity-check your logging — bites, oils and "just a taste" add up), or accept a slower loss. Pick one.`,
    });
  }
  if (lowProtein && !underFloor) {
    findings.push({
      id: "low-protein",
      rank: 65,
      tone: "sassy",
      title: "Protein's been weak",
      cause: `Protein only hit target on ${d.proteinHitRate != null ? Math.round(d.proteinHitRate * 100) : "few"}% of days. On a recomp that's the difference between keeping muscle and waving it goodbye.`,
      fix: `Hit your protein target first, every day, before anything else moves. It's the one macro that's non-negotiable.`,
    });
  }
  if (missedSessions && !underFloor) {
    findings.push({
      id: "missed-sessions",
      rank: 60,
      tone: "sassy",
      title: "You're skipping sessions",
      cause: `Only ${d.sessionsDone} of ${d.plannedSessions} planned sessions done. The plan can't work the days you don't.`,
      fix: `Get consistency above ~80% before blaming the calories. Show up first, then we tune.`,
    });
  }

  // --- PLATEAU / ADAPTATION (neutral) --------------------------------------
  if (
    !underFloor &&
    !losingTooFast &&
    scaleFlat(d) &&
    !inchesDown &&
    !overTarget &&
    d.goalDirection === "loss" &&
    d.weeksElapsed >= 3
  ) {
    findings.push({
      id: "plateau",
      rank: 50,
      tone: "neutral",
      title: "Looks like a genuine plateau",
      cause: `Intake's on target and you're consistent, but the scale and the tape have both stalled for a few weeks. That can be metabolic adaptation after a stretch of loss.`,
      fix: `Consider a short diet break at maintenance for a week to reset, or recompute your maintenance and nudge the target down slightly. Don't just slash calories.`,
    });
  }

  // --- DEFAULT (on track / not enough signal) ------------------------------
  if (findings.length === 0) {
    if (d.onTrack === true || (d.goalDirection === "loss" && underTarget)) {
      findings.push({
        id: "on-track",
        rank: 40,
        tone: "positive",
        title: "On track — keep going",
        cause: `Weight's moving with your goal curve and your intake's in the right place. Nothing to fix.`,
        fix: `Keep doing exactly this. Don't fiddle with what's working.`,
      });
    } else {
      findings.push({
        id: "insufficient",
        rank: 10,
        tone: "neutral",
        title: "Not enough data yet",
        cause: `There aren't enough weigh-ins, logged meals, or sessions in this window to call what's happening.`,
        fix: `Log weight a few times a week and keep tracking meals + workouts — give it a couple of weeks and ask again.`,
      });
    }
  }

  findings.sort((a, b) => b.rank - a.rank);
  return { headline: findings[0]!.title, findings };
}
