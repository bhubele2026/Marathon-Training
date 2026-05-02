import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  generatePlan,
  PLAN_START_ISO,
  RACE_DATE_ISO,
  TOTAL_WEEKS,
  type DailyRow,
  type WeeklyRow,
  type BodyRow,
} from "@workspace/plan-generator";

// Re-export so existing CLI consumers (and seed.ts) keep working without
// having to update their import paths.
export {
  generatePlan,
  PLAN_START_ISO,
  RACE_DATE_ISO,
  TOTAL_WEEKS,
  type DailyRow,
  type WeeklyRow,
  type BodyRow,
};

export function writePlanJson(): string {
  const plan = generatePlan();
  const outPath = resolve(import.meta.dirname, "../../.local/data/plan.json");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(plan));
  return outPath;
}

const isCli = import.meta.url === `file://${process.argv[1]}`;
if (isCli) {
  const outPath = writePlanJson();
  const plan = generatePlan();
  console.log(
    `Wrote ${outPath} — race ${RACE_DATE_ISO}, ${plan.weekly.length} weeks, ${plan.daily.length} days, ${plan.body.length} body rows.`,
  );
}
