import { format, parseISO } from "date-fns";

export function formatDate(dateString?: string | null): string {
  if (!dateString) return "";
  try {
    return format(parseISO(dateString), "MMM d, yyyy");
  } catch (e) {
    return dateString;
  }
}

export function formatPace(pace?: string | null): string {
  if (!pace) return "--:--";
  return pace;
}

export function formatDistance(distanceMi?: number | null): string {
  if (distanceMi == null) return "-";
  return `${distanceMi.toFixed(2)} mi`;
}

export function formatDuration(durationMin?: number | null): string {
  if (durationMin == null) return "-";
  return `${durationMin} min`;
}

export function formatLoad(load?: number | null): string {
  if (load == null) return "-";
  return load.toFixed(0);
}

export function formatWeight(weight?: number | null): string {
  if (weight == null) return "-";
  return `${weight.toFixed(1)} lbs`;
}
