# Marathon Command Center — Handoff

Last updated by the build session ending at commit `178fcba`. This is the
"pick it up cold" doc. For deep architecture see `replit.md`.

## 1. What this is + where it runs

- **App:** Marathon Command Center (branded **BH Studio**) — a Tonal/Peloton
  strength-recomposition + training tracker with a reactive nutrition engine and
  a sardonic British AI coach.
- **Runs on Replit.** The local clone (`~/projects/Marathon-Training`) is for
  editing + version control; the app actually runs on Replit (Node 24, pnpm,
  Postgres). `node_modules` is NOT installed locally.
- **GitHub:** `github.com/bhubele2026/Marathon-Training`, branch `main`. GitHub
  is the source of truth.
- **Live URL:** https://brads-training.replit.app

## 2. Deploy procedure (every time)

In the **Replit Shell**:
```
git fetch && git reset --hard @{u}     # pull latest from GitHub into the workspace
pnpm run typecheck && pnpm run test     # green check
```
Then **Stop → Run** (or Deploy/Redeploy).

- Add `pnpm --filter @workspace/db run push` **only** when a change adds/edits a
  DB table (the schema lives in `lib/db/src/schema`). The last table added was
  `progress_diagnosis`.
- Add `pnpm install` only when dependencies changed.
- `ANTHROPIC_API_KEY` and `NUTRITION_TOKEN` must be set as Replit Secrets
  (coach/AI + Apple-Health import respectively).

## 3. Build status & KNOWN pre-existing failures (not blockers)

- **typecheck: green.**
- **test:** green EXCEPT three pre-existing, unrelated failures from a stale
  theme-palette rename (NOT from recent work):
  - `artifacts/mockup-sandbox/src/theme-bootstrap.test.ts` — missing default
    palette `arctic-performance`.
  - `artifacts/api-server/src/routes/preferences.test.ts` — two `visualTheme`
    cases (old theme names rejected).
  These do **not** gate the deploy (the deploy gate is typecheck + build, not the
  full test run). Fixing them is an open follow-up (see §6).

## 4. Data sync (how real data gets in)

- **Workouts:** iOS Shortcuts CANNOT read past workouts. The feed is the
  **Health Auto Export** app's scheduled REST export → `POST /api/workouts/import`
  (accepts both HAE's `{data:{workouts:[…]}}` and a simple shape; bearer
  `NUTRITION_TOKEN`). Maps activity → machine (Tonal / Peloton Bike/Row/Tread /
  Outdoor). Tonal **Strength Score** is NOT available via any API — entered by
  hand on Goals.
- **Nutrition:** an Apple-Health Shortcut feeds the nutrition ingest (nutrition
  IS a readable quantity sample), same `NUTRITION_TOKEN`.

## 5. What was built recently (newest first)

- **Premium UI + always-on coach** (`bc298d9`, `35cbf48`, `178fcba`):
  - Dismissible, contextual **coach dock** in the shell on every page
    (`components/coach-dock.tsx` + `GET /api/coach/line?context=…`, hand-fetched).
  - Persona cranked to **max sass**, one voice everywhere; wellbeing rails intact.
  - Premium visual system in `index.css` (layered dark canvas, tabular figures,
    smooth transitions, glow/gradient hero accents). BH Studio **orange** is the
    single accent; stale "teal" comments corrected.
- **Visual consistency** (`5af62e3`, `874aaf6`): unified page titles + subtitles;
  fixed not-found dark-mode bug.
- **Smarter tracking** (`1ec1130`…`7505ded`): per-day macros (protein anchored,
  carbs the lever, fat balances); dashboard progress hub (weight-vs-goal curve,
  recomp signals, adherence, 4/8/12-wk); the **diagnosis engine**
  (`/api/progress/diagnosis`, `progress_diagnosis` table); sharper coach.
- **Workout import + nutrition reactivity** (`9344593` and earlier): Health Auto
  Export import; reactive Eat-today; session verdicts.

## 6. Open follow-ups (nothing is half-finished; these are next-ups)

1. **Visual polish needs the screenshot loop.** Phases 3–4 of the premium pass
   were done blind (no local render). The central system is in; per-screen
   pixel-tightening (Plan, week detail, Goals, Settings, Equipment, Races, log,
   planner) should be done with screenshots in both light + dark + mobile.
2. **Fix the pre-existing theme tests** (§3) for a fully green suite — align the
   palette keys / `visualTheme` enum.
3. **Calorie floor guard (safety nicety):** the per-day rest-day reduction floors
   at 800 kcal, not the sex-specific safe floor. Consider clamping adjusted
   calories to `calorieFloor(sex)` in `getDayTarget`
   (`artifacts/api-server/src/lib/nutrition-day-target.ts`). The coach/diagnosis
   never recommend going below the floor; this is only the raw daily target.
4. **Optional:** Tonal Strength Score quick-edit on the dashboard + a "update it"
   nudge; a per-user sass-level setting (needs openapi change + codegen).

## 7. Conventions / invariants (do not break)

- **Orange is the identity.** Single accent everywhere, charts included
  (phase/program coloring is the only intentional multi-hue). Never reintroduce
  teal — the tokens are orange; only old comments said teal (now fixed).
- **Nutrition is LOAD-based, never burned calories.** Device/equipment burn
  figures are overstated and never feed intake. Protein anchored, carbs the
  lever, fat balances. See `nutrition-engine.ts`.
- **Coach wellbeing rails OVERRIDE the persona** at any sass level: mean about
  effort/excuses, never the body/worth; never below the safe floor or above the
  safe rate; full supportive flip on under-eating/too-fast/distress; dismissible.
  `lib/plan-knowledge/persona.ts` + `artifacts/api-server/src/lib/nutrition-safety.ts`.
- **New endpoints in the nutrition/coach/dashboard slices are HAND-FETCHED** (not
  in `openapi.yaml`) by deliberate convention. Endpoints that ARE in the spec use
  Orval — change `lib/api-spec/openapi.yaml` then
  `pnpm --filter @workspace/api-spec run codegen`; never hand-edit generated files.
- **Tests:** preserve `data-testid`s and any test-asserted visible copy.

## 8. Quick verification checklist (after deploy)

- [ ] Coach strip shows on each page; line changes by screen; X dismisses; not blocking.
- [ ] Dark mode: near-black canvas, orange hero, glow on Eat-today calories, gradient Log button.
- [ ] Today: per-session verdict strip; Eat-today shows protein/carbs/cal with the "fuels the work, not burned calories" note.
- [ ] Dashboard (BH Studio logo): tracking hub + "What's going on" diagnosis (needs `progress_diagnosis` table + `ANTHROPIC_API_KEY`).
- [ ] Nutrition "Last 14 days" reads as avg-vs-goal bars.
- [ ] Health Auto Export → a workout lands on the right machine within a sync.
