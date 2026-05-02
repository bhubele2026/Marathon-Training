import { useEffect, useState } from "react";
import { useForm, type Path } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { AlertCircle, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateWorkout,
  useUpdateWorkout,
  Workout,
  WorkoutSuggestions,
} from "@workspace/api-client-react";
import { invalidateMissionRelatedQueries } from "@/lib/invalidate-mission-queries";
import {
  applyValidationErrorsToForm,
  extractValidationError,
} from "@/lib/api-errors";

const TIME_OF_DAY_VALUES = ["AM", "PM", "Other"] as const;
type TimeOfDayValue = (typeof TIME_OF_DAY_VALUES)[number];
// Sentinel for "no tag" since native <select> can't hold a literal null value.
const TIME_OF_DAY_NONE = "__none__";

const MODALITY_VALUES = ["Cardio", "Strength", "Mixed"] as const;
type ModalityValue = (typeof MODALITY_VALUES)[number];
const MODALITY_NONE = "__none__";

// Equipment options grouped by which modality they typically belong to. The
// dropdown renders these as labeled groups so the user can quickly find
// "the machine they used" once they've picked a modality.
const EQUIPMENT_GROUPS: ReadonlyArray<{
  label: string;
  items: ReadonlyArray<{ value: string; label: string }>;
}> = [
  {
    label: "Cardio",
    items: [
      { value: "Peloton Tread", label: "Peloton Tread" },
      { value: "Peloton Bike", label: "Peloton Bike" },
      { value: "Peloton Row", label: "Peloton Row" },
      { value: "Outdoor", label: "Outdoor" },
    ],
  },
  {
    label: "Strength",
    items: [{ value: "Tonal", label: "Tonal" }],
  },
  {
    label: "Other",
    items: [
      { value: "Lifestyle", label: "Lifestyle" },
      { value: "None", label: "None / Rest" },
    ],
  },
];

// Best-effort modality inference from a chosen piece of equipment. Used to
// pre-fill the Modality picker when the user changes equipment without
// having explicitly set a modality yet (and never overwrites an explicit
// user choice).
function inferModalityFromEquipment(equipment: string): ModalityValue | null {
  switch (equipment) {
    case "Tonal":
      return "Strength";
    case "Peloton Tread":
    case "Peloton Bike":
    case "Peloton Row":
    case "Outdoor":
      return "Cardio";
    default:
      return null;
  }
}

const formSchema = z.object({
  date: z.string().min(1, "Date is required"),
  equipment: z.string().min(1, "Equipment is required"),
  sessionType: z.string().min(1, "Session type is required"),
  durationMin: z.coerce.number().optional().nullable(),
  distanceMi: z.coerce.number().optional().nullable(),
  pace: z.string().optional().nullable(),
  avgHr: z.coerce.number().optional().nullable(),
  rpe: z.coerce.number().min(1).max(10).optional().nullable(),
  strengthLoad: z.coerce.number().optional().nullable(),
  totalLoad: z.coerce.number().optional().nullable(),
  notes: z.string().optional().nullable(),
  planDayId: z.number().optional().nullable(),
  timeOfDay: z.enum(TIME_OF_DAY_VALUES).nullable().optional(),
  modality: z.enum(MODALITY_VALUES).nullable().optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface WorkoutFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: Partial<Workout & { planDayId?: number | null }>;
  suggestions?: WorkoutSuggestions | null;
  workoutId?: number;
}

const KNOWN_FIELDS = [
  "date",
  "equipment",
  "sessionType",
  "durationMin",
  "distanceMi",
  "pace",
  "avgHr",
  "rpe",
  "strengthLoad",
  "totalLoad",
  "notes",
  "planDayId",
  "timeOfDay",
  "modality",
] as const satisfies ReadonlyArray<Path<FormValues>>;

export function WorkoutForm({ open, onOpenChange, initial, suggestions, workoutId }: WorkoutFormProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createWorkout = useCreateWorkout();
  const updateWorkout = useUpdateWorkout();
  const [serverFormErrors, setServerFormErrors] = useState<string[]>([]);

  const initialTimeOfDay: TimeOfDayValue | null =
    initial?.timeOfDay && (TIME_OF_DAY_VALUES as readonly string[]).includes(initial.timeOfDay)
      ? (initial.timeOfDay as TimeOfDayValue)
      : null;
  const initialEquipment = initial?.equipment || "None";
  const initialModality: ModalityValue | null =
    initial?.modality && (MODALITY_VALUES as readonly string[]).includes(initial.modality)
      ? (initial.modality as ModalityValue)
      : // For brand-new logs (no workoutId), prefill modality from equipment
        // so the user just confirms rather than setting it from scratch.
        !workoutId
        ? inferModalityFromEquipment(initialEquipment)
        : null;
  const buildDefaults = (): FormValues => ({
    date: initial?.date || new Date().toISOString().split('T')[0],
    equipment: initialEquipment,
    sessionType: initial?.sessionType || "",
    durationMin: initial?.durationMin ?? null,
    distanceMi: initial?.distanceMi ?? null,
    pace: initial?.pace || "",
    avgHr: initial?.avgHr ?? null,
    rpe: initial?.rpe ?? null,
    strengthLoad: initial?.strengthLoad ?? null,
    totalLoad: initial?.totalLoad ?? null,
    notes: initial?.notes || "",
    planDayId: initial?.planDayId ?? null,
    timeOfDay: initialTimeOfDay,
    modality: initialModality,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: buildDefaults(),
  });

  useEffect(() => {
    if (open) {
      form.reset(buildDefaults());
      setServerFormErrors([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.date, initial?.equipment, initial?.sessionType, initial?.planDayId, initial?.modality, workoutId]);

  const handleMutationError = (error: unknown, fallbackTitle: string) => {
    const envelope = extractValidationError(error);
    if (envelope) {
      const { formErrors } = applyValidationErrorsToForm(envelope, form, KNOWN_FIELDS);
      setServerFormErrors(formErrors);
      toast({
        title: "Please fix the highlighted fields",
        description:
          formErrors[0] ??
          "The server rejected this workout. Check the form for details.",
        variant: "destructive",
      });
      return;
    }
    setServerFormErrors([]);
    toast({ title: fallbackTitle, variant: "destructive" });
  };

  const isEditMode = !!workoutId;
  const dirtyFields = form.formState.dirtyFields;
  const historyHelperText = suggestions?.sampleSize
    ? `Based on your last ${suggestions.sampleSize} ${
        suggestions.sampleSize === 1 ? "session" : "sessions"
      }`
    : null;
  const showSuggestion = (fieldName: "rpe" | "avgHr" | "pace") =>
    !isEditMode && suggestions?.[fieldName] != null && !dirtyFields[fieldName];

  const getSuggestionHelperText = (fieldName: "rpe" | "avgHr" | "pace") => {
    if (fieldName === "pace" && suggestions?.paceSource === "plan") {
      return "From your plan";
    }
    return historyHelperText;
  };

  const SuggestedHint = ({ fieldName }: { fieldName: "rpe" | "avgHr" | "pace" }) => {
    const helperText = getSuggestionHelperText(fieldName);
    if (!helperText) return null;
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
        <Badge variant="secondary" className="gap-1 px-1.5 py-0 h-4 text-[10px] font-medium">
          <Sparkles className="h-2.5 w-2.5" />
          Suggested
        </Badge>
        <span>{helperText}</span>
      </div>
    );
  };

  const invalidateData = () => invalidateMissionRelatedQueries(queryClient);

  const onSubmit = (data: FormValues) => {
    setServerFormErrors([]);
    const payload = {
      ...data,
      planDayId: data.planDayId ?? undefined,
      timeOfDay: data.timeOfDay ?? null,
      modality: data.modality ?? null,
    };

    if (workoutId) {
      updateWorkout.mutate({ id: workoutId, data: payload }, {
        onSuccess: () => {
          toast({ title: "Workout updated successfully" });
          invalidateData();
          onOpenChange(false);
          form.reset();
        },
        onError: (error) => {
          handleMutationError(error, "Failed to update workout");
        }
      });
    } else {
      createWorkout.mutate({ data: payload }, {
        onSuccess: () => {
          toast({ title: "Workout logged successfully" });
          invalidateData();
          onOpenChange(false);
          form.reset();
        },
        onError: (error) => {
          handleMutationError(error, "Failed to log workout");
        }
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] overflow-y-auto max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>{workoutId ? "Edit Workout" : "Log Workout"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {serverFormErrors.length > 0 && (
              <Alert variant="destructive" data-testid="workout-form-errors">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>We couldn't save this workout</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-4 space-y-1">
                    {serverFormErrors.map((message, idx) => (
                      <li key={idx}>{message}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="timeOfDay"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Time of Day</FormLabel>
                    <Select
                      value={field.value ?? TIME_OF_DAY_NONE}
                      onValueChange={(v) =>
                        field.onChange(v === TIME_OF_DAY_NONE ? null : (v as TimeOfDayValue))
                      }
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-time-of-day">
                          <SelectValue placeholder="Untagged" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={TIME_OF_DAY_NONE}>Untagged</SelectItem>
                        <SelectItem value="AM">AM</SelectItem>
                        <SelectItem value="PM">PM</SelectItem>
                        <SelectItem value="Other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="sessionType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Session Type</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectGroup>
                          <SelectLabel>Training</SelectLabel>
                          <SelectItem value="Aerobic Base">Aerobic Base</SelectItem>
                          <SelectItem value="Aerobic">Aerobic</SelectItem>
                          <SelectItem value="Aerobic / Shakeout">Aerobic / Shakeout</SelectItem>
                          <SelectItem value="Long Run">Long Run</SelectItem>
                          <SelectItem value="Long Run/Walk">Long Run/Walk</SelectItem>
                          <SelectItem value="Long Session">Long Session</SelectItem>
                          <SelectItem value="Time on Feet">Time on Feet</SelectItem>
                          <SelectItem value="Strength">Strength</SelectItem>
                          <SelectItem value="Durability">Durability</SelectItem>
                          <SelectItem value="Workout">Workout</SelectItem>
                          <SelectItem value="Recovery">Recovery</SelectItem>
                          <SelectItem value="Freshness">Freshness</SelectItem>
                          <SelectItem value="Cross Training">Cross Training</SelectItem>
                          <SelectItem value="Rest">Rest</SelectItem>
                          <SelectItem value="Skipped">Skipped</SelectItem>
                        </SelectGroup>
                        <SelectGroup>
                          <SelectLabel>Lifestyle</SelectLabel>
                          <SelectItem value="Dog Walk">Dog Walk</SelectItem>
                          <SelectItem value="Mow Lawn">Mow Lawn</SelectItem>
                          <SelectItem value="Yard Work">Yard Work</SelectItem>
                          <SelectItem value="House Work">House Work</SelectItem>
                          <SelectItem value="Hike">Hike</SelectItem>
                          <SelectItem value="Manual Labor">Manual Labor</SelectItem>
                          <SelectItem value="Other Activity">Other Activity</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="modality"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cardio or Strength</FormLabel>
                    <Select
                      value={field.value ?? MODALITY_NONE}
                      onValueChange={(v) =>
                        field.onChange(v === MODALITY_NONE ? null : (v as ModalityValue))
                      }
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-modality">
                          <SelectValue placeholder="Pick one" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={MODALITY_NONE}>Untagged</SelectItem>
                        <SelectItem value="Cardio">Cardio</SelectItem>
                        <SelectItem value="Strength">Strength</SelectItem>
                        <SelectItem value="Mixed">Mixed</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="equipment"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Equipment / Machine</FormLabel>
                    <Select
                      onValueChange={(v) => {
                        field.onChange(v);
                        // If the user hasn't picked a modality yet, infer
                        // one from the equipment they just chose so the
                        // explicit cardio/strength tag isn't left blank.
                        const currentModality = form.getValues("modality");
                        if (!currentModality) {
                          const inferred = inferModalityFromEquipment(v);
                          if (inferred) {
                            form.setValue("modality", inferred, {
                              shouldDirty: false,
                              shouldValidate: false,
                            });
                          }
                        }
                      }}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-equipment">
                          <SelectValue placeholder="Select equipment" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {EQUIPMENT_GROUPS.map((group) => (
                          <SelectGroup key={group.label}>
                            <SelectLabel>{group.label}</SelectLabel>
                            {group.items.map((item) => (
                              <SelectItem key={item.value} value={item.value}>
                                {item.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="durationMin"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Duration (min)</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="45" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="distanceMi"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Distance (mi)</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" placeholder="5.0" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="pace"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Pace (min/mi)</FormLabel>
                    <FormControl>
                      <Input placeholder="8:30" {...field} value={field.value ?? ""} />
                    </FormControl>
                    {showSuggestion("pace") && <SuggestedHint fieldName="pace" />}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="avgHr"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Avg HR</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="140" {...field} value={field.value ?? ""} />
                    </FormControl>
                    {showSuggestion("avgHr") && <SuggestedHint fieldName="avgHr" />}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="rpe"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>RPE (1-10)</FormLabel>
                    <FormControl>
                      <Input type="number" min={1} max={10} placeholder="5" {...field} value={field.value ?? ""} />
                    </FormControl>
                    {showSuggestion("rpe") && <SuggestedHint fieldName="rpe" />}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="strengthLoad"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Strength Load</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="0" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="totalLoad"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Total Load</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="0" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea placeholder="How did it feel?" {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end pt-4">
              <Button type="button" variant="outline" className="mr-2" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={createWorkout.isPending || updateWorkout.isPending}>
                {workoutId ? "Save Changes" : "Log Workout"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
