import { useEffect, useState } from "react";
import {
  useGetUserPreferences,
  useUpdateUserPreferences,
  getGetUserPreferencesQueryKey,
  UserPreferencesRunTargetingMode,
  type UserPreferencesRunTargetingMode as RunTargetingMode,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { hrZoneBpmRange, HR_ZONE_COLORS } from "@/lib/run-target";

interface ModeOption {
  value: RunTargetingMode;
  title: string;
  description: string;
  example: string;
}

const MODE_OPTIONS: ModeOption[] = [
  {
    value: UserPreferencesRunTargetingMode.effort,
    title: "Effort (RPE)",
    description:
      "Show every run as a perceived-effort label. Best for runners who don't want pace pressure.",
    example: 'A 30-min easy run shows up as "Easy conversational".',
  },
  {
    value: UserPreferencesRunTargetingMode.intervals,
    title: "Walk / run intervals",
    description:
      "Break each run into walk/run intervals scaled to the planned duration. Walks shrink as the campaign progresses.",
    example: 'A 30-min easy run shows up as "5 min run / 1 min walk × 5".',
  },
  {
    value: UserPreferencesRunTargetingMode.hr_zones,
    title: "Heart-rate zones",
    description:
      "Show runs as HR zones (1–5). Set your max heart rate below to see personalized BPM ranges next to each zone label.",
    example:
      'A 30-min easy run shows up as "Zone 2" (or "Zone 2 · 134-148 bpm" once max HR is set).',
  },
  {
    value: UserPreferencesRunTargetingMode.pace,
    title: "Pace",
    description:
      "Classic min/mile prescription. Use this if you race off pace and your plan has explicit pace targets.",
    example: 'A 30-min easy run shows up as "9:30/mi".',
  },
];

const MIN_MAX_HR = 80;
const MAX_MAX_HR = 230;
const MIN_RESTING_HR = 30;
const MAX_RESTING_HR = 110;

// Fox formula: 220 − age. Good enough as a starting point for runners
// who don't have a measured max HR. We round and clamp to the same
// realistic range the API enforces.
function maxHrFromAge(age: number): number | null {
  if (!Number.isFinite(age) || age < 10 || age > 100) return null;
  const value = 220 - Math.round(age);
  if (value < MIN_MAX_HR || value > MAX_MAX_HR) return null;
  return value;
}

export default function Settings() {
  const { data, isLoading } = useGetUserPreferences();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const update = useUpdateUserPreferences({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetUserPreferencesQueryKey() });
        toast({ title: "Preference saved" });
      },
      onError: () => {
        toast({ title: "Couldn't save preference", variant: "destructive" });
      },
    },
  });

  const value: RunTargetingMode = data?.runTargetingMode ?? "effort";

  // Local form state for the max HR input. Seeded from the saved value
  // and re-synced whenever the prefs query returns fresh data so the
  // input stays in step with optimistic / multi-tab edits.
  const savedMaxHr = data?.maxHr ?? null;
  const savedRestingHr = data?.restingHr ?? null;
  const [maxHrInput, setMaxHrInput] = useState<string>(
    savedMaxHr != null ? String(savedMaxHr) : "",
  );
  const [restingHrInput, setRestingHrInput] = useState<string>(
    savedRestingHr != null ? String(savedRestingHr) : "",
  );
  const [ageInput, setAgeInput] = useState<string>("");
  useEffect(() => {
    setMaxHrInput(savedMaxHr != null ? String(savedMaxHr) : "");
  }, [savedMaxHr]);
  useEffect(() => {
    setRestingHrInput(savedRestingHr != null ? String(savedRestingHr) : "");
  }, [savedRestingHr]);

  const parsedMaxHr =
    maxHrInput.trim() === "" ? null : Number.parseInt(maxHrInput, 10);
  const isMaxHrValid =
    parsedMaxHr === null ||
    (Number.isFinite(parsedMaxHr) &&
      parsedMaxHr >= MIN_MAX_HR &&
      parsedMaxHr <= MAX_MAX_HR);
  const hasMaxHrChanged = parsedMaxHr !== savedMaxHr;

  const parsedRestingHr =
    restingHrInput.trim() === "" ? null : Number.parseInt(restingHrInput, 10);
  const isRestingHrValid =
    parsedRestingHr === null ||
    (Number.isFinite(parsedRestingHr) &&
      parsedRestingHr >= MIN_RESTING_HR &&
      parsedRestingHr <= MAX_RESTING_HR);
  const hasRestingHrChanged = parsedRestingHr !== savedRestingHr;

  // When both maxHr and restingHr are set (and the resting value is in
  // range and strictly below max), the preview ranges switch to the
  // Karvonen / heart-rate-reserve formula. Otherwise we fall back to
  // the % of max model. Either way the table below renders all 5 zones.
  const previewUsesKarvonen =
    parsedMaxHr != null &&
    isMaxHrValid &&
    parsedRestingHr != null &&
    isRestingHrValid &&
    parsedRestingHr < parsedMaxHr;
  const previewRestingHr = previewUsesKarvonen ? parsedRestingHr : null;

  const zoneBuckets = [1, 2, 3, 4, 5] as const;
  const zonePreviews =
    parsedMaxHr != null && isMaxHrValid
      ? zoneBuckets.map((bucket) => ({
          bucket,
          range: hrZoneBpmRange(bucket, parsedMaxHr, previewRestingHr),
        }))
      : null;

  function handleSaveMaxHr() {
    if (!isMaxHrValid || !hasMaxHrChanged) return;
    update.mutate({ data: { maxHr: parsedMaxHr } });
  }

  function handleSaveRestingHr() {
    if (!isRestingHrValid || !hasRestingHrChanged) return;
    update.mutate({ data: { restingHr: parsedRestingHr } });
  }

  function handleApplyAge() {
    const age = Number.parseInt(ageInput, 10);
    const derived = maxHrFromAge(age);
    if (derived == null) {
      toast({
        title: "Enter an age between 10 and 100",
        variant: "destructive",
      });
      return;
    }
    setMaxHrInput(String(derived));
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-3xl mx-auto">
      <div>
        <h2 className="text-3xl font-black uppercase tracking-tight text-primary">Settings</h2>
        <p className="text-muted-foreground uppercase font-medium tracking-widest text-xs mt-1">
          App-wide preferences
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg uppercase tracking-wider">Run targeting</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Choose how prescribed runs are displayed across Today, your weekly plan, and the
            expanded card detail. Switching here updates every upcoming session immediately —
            no plan regeneration needed. Logging still accepts whatever you actually did.
          </p>

          {isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <RadioGroup
              value={value}
              onValueChange={(next) =>
                update.mutate({
                  data: { runTargetingMode: next as RunTargetingMode },
                })
              }
              className="gap-3"
              data-testid="radio-group-run-targeting-mode"
            >
              {MODE_OPTIONS.map((opt) => {
                const id = `run-targeting-${opt.value}`;
                return (
                  <Label
                    key={opt.value}
                    htmlFor={id}
                    className="flex items-start gap-3 rounded-md border border-border p-4 cursor-pointer hover:border-primary/40 has-[:checked]:border-primary has-[:checked]:bg-primary/5 transition-colors"
                    data-testid={`option-run-targeting-${opt.value}`}
                  >
                    <RadioGroupItem
                      value={opt.value}
                      id={id}
                      className="mt-1"
                      data-testid={`radio-run-targeting-${opt.value}`}
                    />
                    <div className="space-y-1">
                      <div className="font-bold uppercase tracking-wider text-sm">
                        {opt.title}
                      </div>
                      <p className="text-xs text-muted-foreground">{opt.description}</p>
                      <p className="text-xs italic text-muted-foreground">{opt.example}</p>
                    </div>
                  </Label>
                );
              })}
            </RadioGroup>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg uppercase tracking-wider">
            Heart-rate zones
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Set your maximum heart rate to personalize the BPM ranges shown alongside
            each "Zone N" label when the HR Zone targeting mode is active. We use the
            standard % of max model: Zone 1 50-60%, Zone 2 60-70%, Zone 3 70-80%, Zone 4
            80-90%, Zone 5 90-100%. Leave blank to fall back to generic zone labels.
            Add your resting HR too and the zones switch to the more accurate Karvonen
            (heart-rate-reserve) formula.
          </p>

          {isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="max-hr-input" className="text-xs uppercase tracking-wider font-bold">
                  Max heart rate (bpm)
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="max-hr-input"
                    type="number"
                    inputMode="numeric"
                    min={MIN_MAX_HR}
                    max={MAX_MAX_HR}
                    placeholder="e.g. 185"
                    value={maxHrInput}
                    onChange={(e) => setMaxHrInput(e.target.value)}
                    className="max-w-[160px]"
                    data-testid="input-max-hr"
                  />
                  <Button
                    type="button"
                    onClick={handleSaveMaxHr}
                    disabled={
                      !isMaxHrValid || !hasMaxHrChanged || update.isPending
                    }
                    data-testid="button-save-max-hr"
                  >
                    Save
                  </Button>
                </div>
                {!isMaxHrValid && (
                  <p
                    className="text-xs text-destructive"
                    data-testid="text-max-hr-error"
                  >
                    Enter a value between {MIN_MAX_HR} and {MAX_MAX_HR} bpm, or leave
                    blank.
                  </p>
                )}
                {zonePreviews && (
                  <div
                    className="rounded-md border border-border bg-muted/30 p-3"
                    data-testid="zone-preview-table"
                    data-preview-model={previewUsesKarvonen ? "karvonen" : "pct-of-max"}
                  >
                    <p className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-2">
                      Preview{previewUsesKarvonen ? " · Karvonen" : ""}
                    </p>
                    <ul className="space-y-1">
                      {zonePreviews.map(({ bucket, range }) => (
                        <li
                          key={bucket}
                          className="flex items-center justify-between gap-4 text-xs"
                          data-testid={`zone-preview-row-${bucket}`}
                        >
                          <span className="flex items-center gap-2">
                            <span
                              aria-hidden="true"
                              className={`inline-block h-3 w-3 rounded-sm ring-1 ring-inset ring-black/10 dark:ring-white/15 ${HR_ZONE_COLORS[bucket].swatchClass}`}
                              data-testid={`zone-preview-swatch-${bucket}`}
                            />
                            <span className="font-bold uppercase tracking-wider">
                              Zone {bucket}
                            </span>
                          </span>
                          <span
                            className="font-mono tabular-nums text-muted-foreground"
                            data-testid={`zone-preview-range-${bucket}`}
                          >
                            {range ? `${range.low}-${range.high} bpm` : "—"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="space-y-2 pt-2 border-t border-border">
                <Label
                  htmlFor="resting-hr-input"
                  className="text-xs uppercase tracking-wider font-bold"
                >
                  Resting heart rate (bpm) — optional
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="resting-hr-input"
                    type="number"
                    inputMode="numeric"
                    min={MIN_RESTING_HR}
                    max={MAX_RESTING_HR}
                    placeholder="e.g. 52"
                    value={restingHrInput}
                    onChange={(e) => setRestingHrInput(e.target.value)}
                    className="max-w-[160px]"
                    data-testid="input-resting-hr"
                  />
                  <Button
                    type="button"
                    onClick={handleSaveRestingHr}
                    disabled={
                      !isRestingHrValid ||
                      !hasRestingHrChanged ||
                      update.isPending
                    }
                    data-testid="button-save-resting-hr"
                  >
                    Save
                  </Button>
                </div>
                {!isRestingHrValid && (
                  <p
                    className="text-xs text-destructive"
                    data-testid="text-resting-hr-error"
                  >
                    Enter a value between {MIN_RESTING_HR} and {MAX_RESTING_HR} bpm,
                    or leave blank.
                  </p>
                )}
                {parsedRestingHr != null &&
                  parsedMaxHr != null &&
                  isRestingHrValid &&
                  isMaxHrValid &&
                  parsedRestingHr >= parsedMaxHr && (
                    <p
                      className="text-xs text-destructive"
                      data-testid="text-resting-hr-vs-max-error"
                    >
                      Resting HR must be below your max HR. Zones will use the
                      % of max model until this is fixed.
                    </p>
                  )}
                <p className="text-xs text-muted-foreground italic">
                  When set alongside max HR, zones use the Karvonen / heart-rate-
                  reserve formula — more accurate, especially for fitter runners
                  with a low resting HR.
                </p>
              </div>

              <div className="space-y-2 pt-2 border-t border-border">
                <Label htmlFor="age-input" className="text-xs uppercase tracking-wider font-bold">
                  Don't know it? Estimate from age (220 − age)
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="age-input"
                    type="number"
                    inputMode="numeric"
                    min={10}
                    max={100}
                    placeholder="Age"
                    value={ageInput}
                    onChange={(e) => setAgeInput(e.target.value)}
                    className="max-w-[120px]"
                    data-testid="input-age"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleApplyAge}
                    disabled={ageInput.trim() === ""}
                    data-testid="button-apply-age"
                  >
                    Fill from age
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground italic">
                  Fills the input above. Press Save to apply.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
