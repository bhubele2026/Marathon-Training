import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
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
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateWorkout,
  useUpdateWorkout,
  Workout,
} from "@workspace/api-client-react";
import { invalidateMissionRelatedQueries } from "@/lib/invalidate-mission-queries";

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
});

type FormValues = z.infer<typeof formSchema>;

interface WorkoutFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: Partial<Workout & { planDayId?: number | null }>;
  workoutId?: number;
}

export function WorkoutForm({ open, onOpenChange, initial, workoutId }: WorkoutFormProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createWorkout = useCreateWorkout();
  const updateWorkout = useUpdateWorkout();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      date: initial?.date || new Date().toISOString().split('T')[0],
      equipment: initial?.equipment || "None",
      sessionType: initial?.sessionType || "Run",
      durationMin: initial?.durationMin || null,
      distanceMi: initial?.distanceMi || null,
      pace: initial?.pace || "",
      avgHr: initial?.avgHr || null,
      rpe: initial?.rpe || null,
      strengthLoad: initial?.strengthLoad || null,
      totalLoad: initial?.totalLoad || null,
      notes: initial?.notes || "",
      planDayId: initial?.planDayId || null,
    },
  });

  const invalidateData = () => invalidateMissionRelatedQueries(queryClient);

  const onSubmit = (data: FormValues) => {
    const payload = {
      ...data,
      planDayId: data.planDayId ?? undefined,
    };

    if (workoutId) {
      updateWorkout.mutate({ id: workoutId, data: payload }, {
        onSuccess: () => {
          toast({ title: "Workout updated successfully" });
          invalidateData();
          onOpenChange(false);
          form.reset();
        },
        onError: () => {
          toast({ title: "Failed to update workout", variant: "destructive" });
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
        onError: () => {
          toast({ title: "Failed to log workout", variant: "destructive" });
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
                name="sessionType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Session Type</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
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
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select equipment" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Tonal">Tonal (Strength)</SelectItem>
                        <SelectItem value="Peloton Tread">Peloton Tread</SelectItem>
                        <SelectItem value="Peloton Bike">Peloton Bike</SelectItem>
                        <SelectItem value="Peloton Row">Peloton Row</SelectItem>
                        <SelectItem value="Outdoor">Outdoor</SelectItem>
                        <SelectItem value="None">None / Rest</SelectItem>
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
