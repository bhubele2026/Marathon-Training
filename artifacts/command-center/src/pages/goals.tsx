import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Beef, Droplet, Dumbbell, Flame, Sparkles, User, Wheat } from "lucide-react";

// Goals page. Hand-fetched against /api/goals (not in openapi.yaml, same
// approach as nutrition.tsx) — keeps the feature self-contained, no codegen.
type Goals = {
  heightIn: number | null;
  age: number | null;
  sex: string | null;
  activityLevel: string | null;
  bodyGoal: string;
  goalWeightLb: number | null;
  calorieTarget: number | null;
  proteinTargetG: number | null;
  carbsTargetG: number | null;
  fatTargetG: number | null;
  targetsRationale: string | null;
  targetsComputedAt: string | null;
  strengthScoreCurrent: number | null;
  strengthScoreGoal: number | null;
  currentWeightLb: number | null;
  aiConfigured: boolean;
  updatedAt: string;
};

const ACTIVITY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "sedentary", label: "Sedentary — desk job, little exercise" },
  { value: "light", label: "Light — 1–3 workouts/week" },
  { value: "moderate", label: "Moderate — 3–5 workouts/week" },
  { value: "active", label: "Active — 6–7 workouts/week" },
  { value: "very_active", label: "Very active — hard daily training" },
];

const GOAL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "recomp", label: "Recomp — lose fat + build muscle" },
  { value: "cut", label: "Cut — fat loss first" },
  { value: "lean_bulk", label: "Lean bulk — muscle first" },
];

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

async function sendJson<T>(url: string, method: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      // ignore — keep the status-code message
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

function numOrNull(s: string): number | null {
  if (s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export default function Goals() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["/api/goals"],
    queryFn: () => getJson<Goals>("/api/goals"),
  });

  // Local form state, seeded from the server row once it loads.
  const [ft, setFt] = useState("");
  const [inch, setInch] = useState("");
  const [age, setAge] = useState("");
  const [sex, setSex] = useState("");
  const [activity, setActivity] = useState("");
  const [bodyGoal, setBodyGoal] = useState("recomp");
  const [goalWeight, setGoalWeight] = useState("");
  const [scoreNow, setScoreNow] = useState("");
  const [scoreGoal, setScoreGoal] = useState("");

  useEffect(() => {
    if (!data) return;
    if (data.heightIn != null) {
      setFt(String(Math.floor(data.heightIn / 12)));
      setInch(String(data.heightIn % 12));
    }
    setAge(data.age != null ? String(data.age) : "");
    setSex(data.sex ?? "");
    setActivity(data.activityLevel ?? "");
    setBodyGoal(data.bodyGoal ?? "recomp");
    setGoalWeight(data.goalWeightLb != null ? String(data.goalWeightLb) : "");
    setScoreNow(
      data.strengthScoreCurrent != null ? String(data.strengthScoreCurrent) : "",
    );
    setScoreGoal(
      data.strengthScoreGoal != null ? String(data.strengthScoreGoal) : "",
    );
  }, [data]);

  const saveStats = useMutation({
    mutationFn: () => {
      const f = numOrNull(ft);
      const i = numOrNull(inch);
      const heightIn = f != null ? f * 12 + (i ?? 0) : null;
      return sendJson<Goals>("/api/goals", "PUT", {
        heightIn,
        age: numOrNull(age),
        sex: sex || null,
        activityLevel: activity || null,
        bodyGoal,
        goalWeightLb: numOrNull(goalWeight),
      });
    },
    onSuccess: (g) => qc.setQueryData(["/api/goals"], g),
  });

  const saveScore = useMutation({
    mutationFn: () =>
      sendJson<Goals>("/api/goals", "PUT", {
        strengthScoreCurrent: numOrNull(scoreNow),
        strengthScoreGoal: numOrNull(scoreGoal),
      }),
    onSuccess: (g) => qc.setQueryData(["/api/goals"], g),
  });

  const computeTargets = useMutation({
    mutationFn: () => sendJson<Goals>("/api/goals/compute-targets", "POST", {}),
    onSuccess: (g) => qc.setQueryData(["/api/goals"], g),
  });

  const protein = data?.proteinTargetG ?? null;
  const calories = data?.calorieTarget ?? null;
  const carbs = data?.carbsTargetG ?? null;
  const fat = data?.fatTargetG ?? null;
  const scoreCur = data?.strengthScoreCurrent ?? null;
  const scoreTgt = data?.strengthScoreGoal ?? null;
  const scorePct =
    scoreCur != null && scoreTgt != null && scoreTgt > 0
      ? Math.min(100, (scoreCur / scoreTgt) * 100)
      : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-primary">
          Goals
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Your stats, AI-calculated nutrition targets, and strength goal.
        </p>
      </div>

      {/* Body stats */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm tracking-wider text-muted-foreground">
            <User className="h-4 w-4 text-primary" /> Body Stats
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Height</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      inputMode="numeric"
                      placeholder="ft"
                      value={ft}
                      onChange={(e) => setFt(e.target.value)}
                    />
                    <span className="text-muted-foreground">ft</span>
                    <Input
                      type="number"
                      inputMode="numeric"
                      placeholder="in"
                      value={inch}
                      onChange={(e) => setInch(e.target.value)}
                    />
                    <span className="text-muted-foreground">in</span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Age</Label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={age}
                    onChange={(e) => setAge(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Sex</Label>
                  <Select value={sex} onValueChange={setSex}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="male">Male</SelectItem>
                      <SelectItem value="female">Female</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Goal weight (lb)</Label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={goalWeight}
                    onChange={(e) => setGoalWeight(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Current:{" "}
                    {data?.currentWeightLb != null
                      ? `${data.currentWeightLb} lb`
                      : "— log a measurement"}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>Activity level</Label>
                  <Select value={activity} onValueChange={setActivity}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {ACTIVITY_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Body goal</Label>
                  <Select value={bodyGoal} onValueChange={setBodyGoal}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {GOAL_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  onClick={() => saveStats.mutate()}
                  disabled={saveStats.isPending}
                >
                  {saveStats.isPending ? "Saving…" : "Save stats"}
                </Button>
                {saveStats.isSuccess && !saveStats.isPending && (
                  <span className="text-xs text-muted-foreground">Saved</span>
                )}
                {saveStats.isError && (
                  <span className="text-xs text-destructive">
                    {(saveStats.error as Error).message}
                  </span>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* AI nutrition targets */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm tracking-wider text-muted-foreground">
            <Sparkles className="h-4 w-4 text-primary" /> Nutrition Targets
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-md border border-border p-4">
              <div className="flex items-center gap-2 text-xs tracking-wider text-muted-foreground">
                <Flame className="h-3.5 w-3.5 text-primary" /> Calories / day
              </div>
              <div className="mt-1 text-4xl font-bold text-primary tabular-nums">
                {calories ?? "—"}
                {calories != null && (
                  <span className="ml-1 text-lg text-muted-foreground">kcal</span>
                )}
              </div>
            </div>
            <div className="rounded-md border border-border p-4">
              <div className="flex items-center gap-2 text-xs tracking-wider text-muted-foreground">
                <Beef className="h-3.5 w-3.5 text-primary" /> Protein / day
              </div>
              <div className="mt-1 text-4xl font-bold tabular-nums">
                {protein ?? "—"}
                {protein != null && (
                  <span className="ml-1 text-lg text-muted-foreground">g</span>
                )}
              </div>
            </div>
            <div className="rounded-md border border-border p-4">
              <div className="flex items-center gap-2 text-xs tracking-wider text-muted-foreground">
                <Wheat className="h-3.5 w-3.5 text-primary" /> Carbs / day
              </div>
              <div className="mt-1 text-4xl font-bold tabular-nums">
                {carbs ?? "—"}
                {carbs != null && (
                  <span className="ml-1 text-lg text-muted-foreground">g</span>
                )}
              </div>
            </div>
            <div className="rounded-md border border-border p-4">
              <div className="flex items-center gap-2 text-xs tracking-wider text-muted-foreground">
                <Droplet className="h-3.5 w-3.5 text-primary" /> Fat / day
              </div>
              <div className="mt-1 text-4xl font-bold tabular-nums">
                {fat ?? "—"}
                {fat != null && (
                  <span className="ml-1 text-lg text-muted-foreground">g</span>
                )}
              </div>
            </div>
          </div>

          {data?.targetsRationale && (
            <p className="text-sm text-muted-foreground border-l-2 border-primary/40 pl-3">
              {data.targetsRationale}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => computeTargets.mutate()}
              disabled={computeTargets.isPending || data?.aiConfigured === false}
            >
              {computeTargets.isPending
                ? "Researching current guidance…"
                : protein != null
                  ? "Recalculate with AI"
                  : "Calculate my targets with AI"}
            </Button>
            {data?.aiConfigured === false && (
              <span className="text-xs text-destructive">
                Set ANTHROPIC_API_KEY to enable AI targets.
              </span>
            )}
            {computeTargets.isError && (
              <span className="text-xs text-destructive">
                {(computeTargets.error as Error).message}
              </span>
            )}
            {data?.targetsComputedAt && (
              <span className="text-xs text-muted-foreground">
                Based on live web research ·{" "}
                {new Date(data.targetsComputedAt).toLocaleDateString()}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Tonal Strength Score goal */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm tracking-wider text-muted-foreground">
            <Dumbbell className="h-4 w-4 text-primary" /> Tonal Strength Score
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Current score</Label>
              <Input
                type="number"
                inputMode="numeric"
                value={scoreNow}
                onChange={(e) => setScoreNow(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Goal score</Label>
              <Input
                type="number"
                inputMode="numeric"
                value={scoreGoal}
                onChange={(e) => setScoreGoal(e.target.value)}
              />
            </div>
          </div>
          {scoreCur != null && scoreTgt != null && (
            <div>
              <Progress value={scorePct} className="h-2" />
              <p className="mt-2 text-xs text-muted-foreground">
                {scoreTgt - scoreCur > 0
                  ? `${scoreTgt - scoreCur} points to go`
                  : "Goal reached"}
              </p>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            The Tonal Strength Score isn't shared to Apple Health, so update it
            here from your Tonal app.
          </p>
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              onClick={() => saveScore.mutate()}
              disabled={saveScore.isPending}
            >
              {saveScore.isPending ? "Saving…" : "Save score"}
            </Button>
            {saveScore.isError && (
              <span className="text-xs text-destructive">
                {(saveScore.error as Error).message}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
