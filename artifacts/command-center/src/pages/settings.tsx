import { useEffect, useState } from "react";
import {
  useGetUserPreferences,
  useGetSuggestedRestingHr,
  useUpdateUserPreferences,
  getGetUserPreferencesQueryKey,
  UserPreferencesRunTargetingMode,
  UserPreferencesHrZoneModel,
  type UserPreferencesRunTargetingMode as RunTargetingMode,
  type UserPreferencesHrZoneModel as HrZoneModel,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  HR_ZONE_COLORS,
  HR_ZONE_MODEL_DESCRIPTIONS,
  HR_ZONE_MODEL_LABELS,
  getHrZoneModelDef,
  resolveHrZoneModel,
} from "@/lib/run-target";
import { useVisualTheme } from "@/lib/visual-theme";
import { type ThemeKey } from "@/lib/visual-themes";

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
      "Break each run into walk/run intervals scaled to the planned duration. Walks shrink as the plan progresses.",
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
  const { data: restingHrSuggestion } = useGetSuggestedRestingHr();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { themeKey, setThemeKey, themes } = useVisualTheme();
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
  const hrZoneModel: HrZoneModel = resolveHrZoneModel(data?.hrZoneModel);
  const hrZoneModelDef = getHrZoneModelDef(hrZoneModel);

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

  // Task #158 — preview rows iterate the active model's zone table
  // rather than the hard-coded 1-5 buckets. Friel ships 7 rows,
  // polarized 3, etc. We still expose `zone-preview-{row,swatch,range}-N`
  // test ids keyed by the 1-indexed zone number so existing
  // bucket-1..5 assertions keep working under the 5-zone default.
  const zonePreviews =
    parsedMaxHr != null && isMaxHrValid
      ? hrZoneModelDef.zones.map((zone, idx) => {
          const reserve =
            previewUsesKarvonen && parsedMaxHr != null && previewRestingHr != null
              ? parsedMaxHr - previewRestingHr
              : null;
          const range =
            reserve != null && previewRestingHr != null
              ? {
                  low: Math.round(reserve * zone.lowPct + previewRestingHr),
                  high: Math.round(reserve * zone.highPct + previewRestingHr),
                }
              : {
                  low: Math.round(parsedMaxHr * zone.lowPct),
                  high: Math.round(parsedMaxHr * zone.highPct),
                };
          return {
            zoneNumber: idx + 1,
            label: zone.label,
            swatchClass: zone.swatchClass,
            range,
          };
        })
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
        <h2 className="text-4xl font-extrabold tracking-tight text-foreground">Settings</h2>
        <p className="text-muted-foreground font-medium tracking-widest text-xs mt-1">
          App-wide preferences
        </p>
      </div>

      <Card data-testid="card-visual-theme">
        <CardHeader>
          <CardTitle className="text-lg tracking-wider">Visual theme</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Pick the palette that powers the entire Command Center. Your choice
            applies instantly across light and dark mode, including phase colors
            and chart accents, and syncs to your account so the same theme
            follows you on every device.
          </p>
          <RadioGroup
            value={themeKey}
            onValueChange={(next) => setThemeKey(next as ThemeKey)}
            className="grid gap-3 sm:grid-cols-2"
            data-testid="radio-group-visual-theme"
          >
            {themes.map((theme) => {
              const id = `visual-theme-${theme.key}`;
              return (
                <Label
                  key={theme.key}
                  htmlFor={id}
                  className="flex items-start gap-3 rounded-md border border-border p-4 cursor-pointer hover:border-primary/40 has-[:checked]:border-primary has-[:checked]:bg-primary/5 transition-colors"
                  data-testid={`option-visual-theme-${theme.key}`}
                >
                  <RadioGroupItem
                    value={theme.key}
                    id={id}
                    className="mt-1"
                    data-testid={`radio-visual-theme-${theme.key}`}
                  />
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-bold tracking-wider text-sm">
                        {theme.name}
                      </div>
                      <span className="text-[10px] tracking-widest font-mono text-muted-foreground">
                        {theme.number}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-snug">
                      {theme.tagline}
                    </p>
                    <div
                      className="flex items-center gap-1.5"
                      aria-hidden="true"
                      data-testid={`swatches-visual-theme-${theme.key}`}
                    >
                      {[
                        theme.light.primary,
                        theme.light.accent,
                        theme.phaseColors.foundation,
                        theme.phaseColors.aerobic,
                        theme.phaseColors.taper,
                      ].map((token, idx) => {
                        // The first two come straight from the light
                        // tokens block (raw "H S% L%"), the phase
                        // colors are already wrapped in `hsl(...)`.
                        const isHsl = token.startsWith("hsl");
                        const background = isHsl ? token : `hsl(${token})`;
                        return (
                          <span
                            key={idx}
                            className="h-4 w-4 rounded-full ring-1 ring-inset ring-black/10 dark:ring-white/15"
                            style={{ background }}
                          />
                        );
                      })}
                    </div>
                  </div>
                </Label>
              );
            })}
          </RadioGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg tracking-wider">Run targeting</CardTitle>
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
                      <div className="font-bold tracking-wider text-sm">
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
          <CardTitle className="text-lg tracking-wider">
            Heart-rate zones
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Set your maximum heart rate to personalize the BPM ranges shown alongside
            each "Zone N" label when the HR Zone targeting mode is active. The default
            5-zone % of max model splits things 50 / 60 / 70 / 80 / 90 / 100. Coached
            runners can swap to Friel's 7-zone, Coggan, or polarized 3-zone via the
            Zone model dropdown. Leave max HR blank to fall back to generic zone
            labels; add your resting HR too and the zones switch to the more accurate
            Karvonen (heart-rate-reserve) formula.
          </p>

          {isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label
                  htmlFor="hr-zone-model-select"
                  className="text-xs tracking-wider font-bold"
                >
                  Zone model
                </Label>
                <Select
                  value={hrZoneModel}
                  onValueChange={(next) =>
                    update.mutate({
                      data: { hrZoneModel: next as HrZoneModel },
                    })
                  }
                >
                  <SelectTrigger
                    id="hr-zone-model-select"
                    className="max-w-sm"
                    data-testid="select-hr-zone-model"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(
                      Object.values(UserPreferencesHrZoneModel) as HrZoneModel[]
                    ).map((m) => (
                      <SelectItem
                        key={m}
                        value={m}
                        data-testid={`option-hr-zone-model-${m}`}
                      >
                        {HR_ZONE_MODEL_LABELS[m]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p
                  className="text-xs text-muted-foreground italic"
                  data-testid="text-hr-zone-model-description"
                >
                  {HR_ZONE_MODEL_DESCRIPTIONS[hrZoneModel]}
                </p>
              </div>

              <div className="space-y-2 pt-2 border-t border-border">
                <Label htmlFor="max-hr-input" className="text-xs tracking-wider font-bold">
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
                    data-zone-model={hrZoneModel}
                  >
                    <p className="text-[10px] tracking-widest font-bold text-muted-foreground mb-2">
                      Preview · {HR_ZONE_MODEL_LABELS[hrZoneModel]}
                      {previewUsesKarvonen ? " · Karvonen" : ""}
                    </p>
                    <ul className="space-y-1">
                      {zonePreviews.map(({ zoneNumber, label, swatchClass, range }) => {
                        // Task #158: swatch class comes from the active
                        // model's zone definition so models with extra
                        // (or fewer) zones still get a sensible color
                        // ramp. The 5-zone default keeps the legacy
                        // HR_ZONE_COLORS palette so existing fixtures
                        // (Settings swatch tests #167 / #171) keep
                        // matching the same Tailwind tokens.
                        const fivezoneSwatch =
                          hrZoneModel === "five_zone_max" &&
                          (zoneNumber === 1 ||
                            zoneNumber === 2 ||
                            zoneNumber === 3 ||
                            zoneNumber === 4 ||
                            zoneNumber === 5)
                            ? HR_ZONE_COLORS[zoneNumber].swatchClass
                            : swatchClass;
                        return (
                          <li
                            key={zoneNumber}
                            className="flex items-center justify-between gap-4 text-xs"
                            data-testid={`zone-preview-row-${zoneNumber}`}
                          >
                            <span className="flex items-center gap-2">
                              {/* Task #167: gate the colored swatch on
                                  the active mode being hr_zones so the
                                  Settings preview matches RunTargetLine's
                                  behaviour — the swatch is only
                                  meaningful when the user has actually
                                  opted into HR-zone targeting. The BPM
                                  range column stays visible in every
                                  mode so the preview table is still
                                  informative when picking modes. */}
                              {value === "hr_zones" && (
                                <span
                                  aria-hidden="true"
                                  className={`inline-block h-3 w-3 rounded-sm ring-1 ring-inset ring-black/10 dark:ring-white/15 ${fivezoneSwatch}`}
                                  data-testid={`zone-preview-swatch-${zoneNumber}`}
                                />
                              )}
                              <span className="font-bold tracking-wider">
                                {label}
                              </span>
                            </span>
                            <span
                              className="font-mono tabular-nums text-muted-foreground"
                              data-testid={`zone-preview-range-${zoneNumber}`}
                            >
                              {range ? `${range.low}-${range.high} bpm` : "—"}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>

              <div className="space-y-2 pt-2 border-t border-border">
                <Label
                  htmlFor="resting-hr-input"
                  className="text-xs tracking-wider font-bold"
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
                {/* Task #157: server-derived "Use N bpm" suggestion. Only
                    shown when the runner hasn't saved a resting HR yet (so
                    we never overwrite a manual value silently) AND the API
                    has enough HR data to make a confident suggestion.
                    Mirrors the "Fill from age" affordance — clicking only
                    fills the input; the runner still has to press Save. */}
                {savedRestingHr == null &&
                  restingHrSuggestion?.value != null && (
                    <div
                      className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
                      data-testid="resting-hr-suggestion"
                    >
                      <span>
                        From your last {restingHrSuggestion.sampleCount}{" "}
                        workout
                        {restingHrSuggestion.sampleCount === 1 ? "" : "s"}{" "}
                        with HR data, we'd guess around{" "}
                        <span className="font-bold text-foreground">
                          {restingHrSuggestion.value} bpm
                        </span>
                        .
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          setRestingHrInput(String(restingHrSuggestion.value))
                        }
                        data-testid="button-apply-suggested-resting-hr"
                      >
                        Use {restingHrSuggestion.value} bpm
                      </Button>
                    </div>
                  )}
                <p className="text-xs text-muted-foreground italic">
                  When set alongside max HR, zones use the Karvonen / heart-rate-
                  reserve formula — more accurate, especially for fitter runners
                  with a low resting HR.
                </p>
              </div>

              <div className="space-y-2 pt-2 border-t border-border">
                <Label htmlFor="age-input" className="text-xs tracking-wider font-bold">
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

      <Card data-testid="card-connections">
        <CardHeader>
          <CardTitle className="text-lg tracking-wider">Connections</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm text-muted-foreground">
            How your Tonal, Peloton, and treadmill work gets into the Command
            Center. There is no "connect" button here on purpose — these
            devices have no public sync API, so the honest path is Apple Health.
          </p>

          {/* Automatic — the real sync. Apple Health is the bridge: Tonal,
              Peloton (Bike/Row/Tread) and treadmill runs all write workouts to
              Apple Health, and an Apple Shortcut pushes them to the server. */}
          <div
            className="rounded-md border border-border p-4 space-y-3"
            data-testid="connections-apple-health"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold tracking-wider text-sm">
                Automatic — Apple Health
              </span>
              <span className="text-[10px] tracking-widest font-bold text-primary">
                RECOMMENDED
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              Tonal, Peloton (Bike, Row, Tread) and your treadmill all write
              their workouts to Apple Health. An Apple Shortcut on your iPhone
              reads those workouts and pushes them to the Command Center, where
              they're deduplicated and linked to the matching planned day. No
              account linking, no scraping, no fake integrations.
            </p>
            <div className="space-y-1">
              <p className="text-xs font-bold tracking-wider text-muted-foreground">
                Set up the Shortcut (one time)
              </p>
              <ol className="list-decimal pl-5 text-sm text-muted-foreground space-y-1">
                <li>
                  In the iOS Shortcuts app, create a shortcut that uses
                  "Find Health Samples" → Workouts (filter to recent days).
                </li>
                <li>
                  Add a "Get Contents of URL" action: method{" "}
                  <span className="font-mono text-foreground">POST</span> to{" "}
                  <span className="font-mono text-foreground">
                    /api/workouts/import
                  </span>{" "}
                  on your Command Center URL.
                </li>
                <li>
                  Send a JSON body of{" "}
                  <span className="font-mono text-foreground">
                    {"{ token, workouts: [...] }"}
                  </span>{" "}
                  — each workout carries its type, start time, duration,
                  distance, average HR and calories.
                </li>
                <li>
                  Put your ingest token in the{" "}
                  <span className="font-mono text-foreground">token</span> field.
                  It must match the{" "}
                  <span className="font-mono text-foreground">
                    NUTRITION_TOKEN
                  </span>{" "}
                  secret set on the server (the same token the nutrition sync
                  uses).
                </li>
                <li>
                  Add an Automation to run the Shortcut daily (e.g. after your
                  last workout) so new sessions flow in on their own.
                </li>
              </ol>
            </div>
            <p className="text-xs text-muted-foreground italic">
              Re-running is safe — imports are idempotent on each workout's
              source key, so duplicates are skipped.
            </p>
          </div>

          {/* Manual — Tonal Strength Score. App-only, no API anywhere. */}
          <div
            className="rounded-md border border-border p-4 space-y-2"
            data-testid="connections-strength-score"
          >
            <span className="font-bold tracking-wider text-sm">
              Manual — Tonal Strength Score
            </span>
            <p className="text-sm text-muted-foreground">
              The Tonal Strength Score lives only inside the Tonal app — it
              isn't exposed through Apple Health or any API. Read it off your
              Tonal and enter it (current and goal) on the{" "}
              <a
                href="/goals"
                className="text-primary font-medium hover:underline"
                data-testid="link-connections-goals"
              >
                Goals
              </a>{" "}
              page so the recomp dashboard can track it toward your target.
            </p>
          </div>

          {/* Peloton note — we deliberately do NOT add an unofficial member-API
              fetch. Peloton already writes to Apple Health, so the bridge above
              covers it. */}
          <p
            className="text-xs text-muted-foreground"
            data-testid="connections-peloton-note"
          >
            Peloton: there's no official Peloton API, so there's no separate
            Peloton connection here. Your Peloton rides and runs already land in
            Apple Health and sync through the bridge above.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
