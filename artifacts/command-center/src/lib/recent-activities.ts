import { LIFESTYLE_PRESETS, type LifestylePreset } from "@/lib/lifestyle-presets";

export type RecentLifestyleEntry = { sessionType: string; lastLoggedAt: string };

export function sortPresetsByRecent(
  presets: LifestylePreset[],
  recent: ReadonlyArray<RecentLifestyleEntry | string>,
): LifestylePreset[] {
  const bySession = new Map(presets.map((p) => [p.sessionType, p]));
  const ordered: LifestylePreset[] = [];
  const seen = new Set<string>();
  for (const entry of recent) {
    const st = typeof entry === "string" ? entry : entry.sessionType;
    const p = bySession.get(st);
    if (p && !seen.has(p.sessionType)) {
      ordered.push(p);
      seen.add(p.sessionType);
    }
  }
  for (const p of presets) {
    if (!seen.has(p.sessionType)) ordered.push(p);
  }
  return ordered;
}

export function getRecentNonPresetActivities(
  recent: ReadonlyArray<RecentLifestyleEntry | string>,
): string[] {
  const presetSessionTypes = new Set(LIFESTYLE_PRESETS.map((p) => p.sessionType));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of recent) {
    const st = typeof entry === "string" ? entry : entry.sessionType;
    if (presetSessionTypes.has(st) || seen.has(st)) continue;
    seen.add(st);
    out.push(st);
  }
  return out;
}
