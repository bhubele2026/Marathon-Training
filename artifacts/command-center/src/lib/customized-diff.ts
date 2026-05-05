export const CUSTOMIZED_FIELD_LABELS: Record<string, string> = {
  sessionType: "Session type",
  equipment: "Equipment",
  description: "Description",
  distanceMi: "Distance",
  strengthMin: "Lift minutes",
  cardioMin: "Cardio minutes",
  runMin: "Run minutes",
  pace: "Pace",
  strengthLoad: "Strength load",
  totalLoad: "Total load",
  isRest: "Rest day",
};

export function formatDiffValue(field: string, value: string | null): string {
  if (value == null || value === "") return "—";
  if (field === "distanceMi") return `${value} mi`;
  if (field === "strengthMin" || field === "cardioMin" || field === "runMin") {
    return `${value} min`;
  }
  if (field === "isRest") return value === "true" ? "Rest" : "Active";
  return value;
}

export function customizedFieldLabel(field: string): string {
  return CUSTOMIZED_FIELD_LABELS[field] ?? field;
}
