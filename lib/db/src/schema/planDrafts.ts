import { pgTable, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

// Phase 3: the iterative coach's WORKING DRAFT. Single-row (id=1), single-user.
// Persists the in-progress plan + the conversation so the runner can leave the
// builder, come back, and keep refining without losing the draft. This is NOT
// the applied plan — applying writes through to planner_configs / plan_days; the
// draft is just the scratchpad the chat loop reads and writes each turn.
export const planDraftsTable = pgTable("plan_drafts", {
  id: integer("id").primaryKey(), // always 1
  // The current working AiPlan (typed loosely as jsonb — the api-server owns the
  // AiPlan shape; storing it raw keeps this package dependency-free).
  plan: jsonb("plan").$type<unknown>(),
  // The chat transcript: [{ role: "user" | "assistant", content }].
  messages: jsonb("messages").$type<Array<{ role: string; content: string }>>(),
  // Optional name the runner typed for the plan.
  name: jsonb("name").$type<string | null>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PlanDraftRow = typeof planDraftsTable.$inferSelect;
