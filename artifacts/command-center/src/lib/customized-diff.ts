export const CUSTOMIZED_FIELD_LABELS: Record<string, string> = {
  sessionType: "Session type",
  equipment: "Equipment",
  equipmentList: "Equipment rail",
  description: "Description",
  distanceMi: "Distance",
  durationMin: "Duration",
  strengthMin: "Lift minutes",
  cardioMin: "Cardio minutes",
  runMin: "Run minutes",
  pace: "Pace",
  avgHr: "Avg HR",
  rpe: "RPE",
  strengthLoad: "Strength load",
  totalLoad: "Total load",
  notes: "Notes",
  timeOfDay: "Time of day",
  modality: "Modality",
  isRest: "Rest day",
};

export function formatDiffValue(field: string, value: string | null): string {
  if (value == null || value === "") return "—";
  if (field === "distanceMi") return `${value} mi`;
  if (
    field === "strengthMin" ||
    field === "cardioMin" ||
    field === "runMin" ||
    field === "durationMin"
  ) {
    return `${value} min`;
  }
  if (field === "avgHr") return `${value} bpm`;
  if (field === "isRest") return value === "true" ? "Rest" : "Active";
  return value;
}

export function customizedFieldLabel(field: string): string {
  return CUSTOMIZED_FIELD_LABELS[field] ?? field;
}
