// Session minute buckets, normalized to match the SESSION TYPE — the same way
// imported workouts are bucketed (run -> runMin, strength -> strengthMin,
// cardio machines -> cardioMin; see mapActivity in the workouts route). AI-
// authored plans sometimes park a Run or Strength day's minutes in cardioMin,
// which then can't line up with the logged actual (which DID bucket by type),
// so the session card's headline reads the wrong (empty) bucket.
//
// The rule is deliberately conservative: it only MOVES minutes out of cardio
// when the session type clearly says run/strength AND that type's own bucket is
// empty. Intentional mixed sessions (a strength day with a genuine cardio
// finisher, where strengthMin is already populated) are left untouched, as are
// real cardio-machine sessions (Ride / Row / Conditioning / Walk).

export type SessionBuckets = {
  strengthMin: number;
  cardioMin: number;
  runMin: number;
};

// Mirror the import's activity matching (mapActivity): run/jog -> run; the
// strength family (strength/lift/tonal/upper/lower/full body/push/pull/...) ->
// strength. Everything else (ride/row/conditioning/walk/...) stays cardio.
const RUN_RE = /run|jog|tread/i;
const STRENGTH_RE =
  /strength|lift|tonal|upper|lower|full body|push|pull|legs|chest|back|arms|core|hypertroph|weight|functional/i;

export function normalizeSessionBuckets(
  sessionType: string | null | undefined,
  b: SessionBuckets,
): SessionBuckets {
  const t = sessionType ?? "";
  // A run day whose minutes are stuck in cardio -> move them to run.
  if (RUN_RE.test(t) && b.runMin === 0 && b.cardioMin > 0) {
    return { strengthMin: b.strengthMin, cardioMin: 0, runMin: b.cardioMin };
  }
  // A strength day whose minutes are stuck in cardio -> move them to strength.
  if (STRENGTH_RE.test(t) && b.strengthMin === 0 && b.cardioMin > 0) {
    return { strengthMin: b.cardioMin, cardioMin: 0, runMin: b.runMin };
  }
  return { strengthMin: b.strengthMin, cardioMin: b.cardioMin, runMin: b.runMin };
}
