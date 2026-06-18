import { useEffect } from "react";
import { LIFESTYLE_EQUIPMENT } from "@workspace/plan-generator";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useUpdatePlanDay, PlanDay } from "@workspace/api-client-react";
import { invalidateMissionRelatedQueries } from "@/lib/invalidate-mission-queries";

const formSchema = z.object({
  sessionType: z.string().min(1, "Session type is required"),
  equipment: z.string().min(1, "Equipment is required"),
  otherEquipment: z.string(),
  description: z.string(),
  distanceMi: z.coerce.number().optional().nullable(),
  strengthMin: z.coerce.number().optional().nullable(),
  cardioMin: z.coerce.number().optional().nullable(),
  runMin: z.coerce.number().optional().nullable(),
  pace: z.string().optional().nullable(),
  strengthLoad: z.coerce.number().optional().nullable(),
  totalLoad: z.coerce.number(),
  isRest: z.boolean(),
});

type FormValues = z.infer<typeof formSchema>;

interface PlanDayFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  planDay: PlanDay;
}

export function PlanDayForm({ open, onOpenChange, planDay }: PlanDayFormProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updatePlanDay = useUpdatePlanDay();

  const buildDefaults = (): FormValues => ({
    sessionType: planDay.sessionType,
    equipment: planDay.equipment,
    otherEquipment: (planDay.equipmentList ?? [])
      .slice(1)
      .filter((m) => m && m.trim().length > 0)
      .join(", "),
    description: planDay.description ?? "",
    distanceMi: planDay.distanceMi ?? null,
    strengthMin: planDay.strengthMin ?? null,
    cardioMin: planDay.cardioMin ?? null,
    runMin: planDay.runMin ?? null,
    pace: planDay.pace ?? "",
    strengthLoad: planDay.strengthLoad ?? null,
    totalLoad: planDay.totalLoad ?? 0,
    isRest: planDay.isRest,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: buildDefaults(),
  });

  useEffect(() => {
    if (open) form.reset(buildDefaults());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, planDay.id]);

  const onSubmit = (data: FormValues) => {
    const others = data.otherEquipment
      .split(",")
      .map((m) => m.trim())
      .filter((m) => m.length > 0);
    const equipmentList = [data.equipment, ...others];
    updatePlanDay.mutate(
      {
        id: planDay.id,
        data: {
          sessionType: data.sessionType,
          equipment: data.equipment,
          equipmentList,
          description: data.description,
          distanceMi: data.distanceMi ?? null,
          strengthMin: data.strengthMin ?? null,
          cardioMin: data.cardioMin ?? null,
          runMin: data.runMin ?? null,
          pace: data.pace ? data.pace : null,
          strengthLoad: data.strengthLoad ?? null,
          totalLoad: data.totalLoad,
          isRest: data.isRest,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Plan updated" });
          invalidateMissionRelatedQueries(queryClient);
          onOpenChange(false);
        },
        onError: () => {
          toast({ title: "Failed to update plan", variant: "destructive" });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] overflow-y-auto max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Edit Planned Session</DialogTitle>
          <DialogDescription>
            Adjust the prescription for {planDay.day} ({planDay.date}). This changes the plan, not a logged workout.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="isRest"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div>
                    <FormLabel className="text-sm font-bold tracking-wider">Rest Day</FormLabel>
                    <p className="text-xs text-muted-foreground mt-1">Toggle on to mark this day as rest / recovery.</p>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      data-testid="switch-plan-is-rest"
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="sessionType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Session Type</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-plan-session-type">
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
                        </SelectGroup>
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
                    <FormLabel>Equipment</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-plan-equipment">
                          <SelectValue placeholder="Select equipment" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Tonal">Tonal (Strength)</SelectItem>
                        <SelectItem value="Peloton Tread">Peloton Tread</SelectItem>
                        <SelectItem value="Peloton Bike">Peloton Bike</SelectItem>
                        <SelectItem value="Peloton Row">Peloton Row</SelectItem>
                        <SelectItem value="Outdoor">Outdoor</SelectItem>
                        <SelectItem value={LIFESTYLE_EQUIPMENT}>{LIFESTYLE_EQUIPMENT}</SelectItem>
                        <SelectItem value="None">None / Rest</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="otherEquipment"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>Other machines (optional)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Peloton Bike, Peloton Row"
                        {...field}
                        data-testid="input-plan-other-equipment"
                      />
                    </FormControl>
                    <p className="text-[11px] text-muted-foreground">
                      Comma-separated. The primary above is shown first; these chip on after it.
                    </p>
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
                      <Input type="number" step="0.01" placeholder="5.0" {...field} value={field.value ?? ""} data-testid="input-plan-distance" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="strengthMin"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Lift (min)</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="0" {...field} value={field.value ?? ""} data-testid="input-plan-strength-min" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="cardioMin"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cardio (min)</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="0" {...field} value={field.value ?? ""} data-testid="input-plan-cardio-min" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="runMin"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Run (min)</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="0" {...field} value={field.value ?? ""} data-testid="input-plan-run-min" />
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
                      <Input placeholder="8:30" {...field} value={field.value ?? ""} data-testid="input-plan-pace" />
                    </FormControl>
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
                      <Input type="number" placeholder="0" {...field} value={field.value ?? ""} data-testid="input-plan-strength-load" />
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
                      <Input type="number" placeholder="0" {...field} value={field.value ?? ""} data-testid="input-plan-total-load" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea placeholder="What is this session?" {...field} data-testid="textarea-plan-description" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end pt-4">
              <Button type="button" variant="outline" className="mr-2" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={updatePlanDay.isPending} data-testid="button-save-plan-day">
                {updatePlanDay.isPending ? "Saving..." : "Save Plan"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
