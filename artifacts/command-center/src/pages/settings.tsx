import {
  useGetUserPreferences,
  useUpdateUserPreferences,
  getGetUserPreferencesQueryKey,
  UserPreferencesRunTargetingMode,
  type UserPreferencesRunTargetingMode as RunTargetingMode,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

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
      "Show runs as HR zones (1–5). Targets only — we don't pull live data from your watch.",
    example: 'A 30-min easy run shows up as "Zone 2".',
  },
  {
    value: UserPreferencesRunTargetingMode.pace,
    title: "Pace",
    description:
      "Classic min/mile prescription. Use this if you race off pace and your plan has explicit pace targets.",
    example: 'A 30-min easy run shows up as "9:30/mi".',
  },
];

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
    </div>
  );
}
