import { Dog, Trees, Home, Mountain, type LucideIcon } from "lucide-react";

export type LifestylePreset = {
  label: string;
  icon: LucideIcon;
  sessionType: string;
};

export const LIFESTYLE_PRESETS: LifestylePreset[] = [
  { label: "Walk Dogs", icon: Dog, sessionType: "Dog Walk" },
  { label: "Mow Lawn", icon: Trees, sessionType: "Mow Lawn" },
  { label: "Yard Work", icon: Home, sessionType: "Yard Work" },
  { label: "Hike", icon: Mountain, sessionType: "Hike" },
];
