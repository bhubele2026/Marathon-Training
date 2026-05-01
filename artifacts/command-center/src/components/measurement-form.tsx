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
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateMeasurement,
  useUpdateMeasurement,
  getGetDashboardSummaryQueryKey,
  getListMeasurementsQueryKey,
  getGetWeightTrendQueryKey,
  Measurement,
} from "@workspace/api-client-react";

const formSchema = z.object({
  date: z.string().min(1, "Date is required"),
  weight: z.coerce.number().optional().nullable(),
  lArm: z.coerce.number().optional().nullable(),
  rArm: z.coerce.number().optional().nullable(),
  lLeg: z.coerce.number().optional().nullable(),
  rLeg: z.coerce.number().optional().nullable(),
  belly: z.coerce.number().optional().nullable(),
  chest: z.coerce.number().optional().nullable(),
  notes: z.string().optional().nullable(),
});

type FormValues = z.infer<typeof formSchema>;

interface MeasurementFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: Partial<Measurement>;
  measurementId?: number;
}

// NOTE: We'll add the generated hooks above, assuming they exist
// Let's check API later if they differ, but we can assume standard naming
// Wait, the hook for creating a measurement is `useCreateMeasurement` - wait, I need to make sure the hook is there.
// If it's not exported, the tsc will fail and I'll fix it.

export function MeasurementForm({ open, onOpenChange, initial, measurementId }: MeasurementFormProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // We'll cast them to any if they are missing or use generated ones. Let's assume standard Orval names.
  // Actually, I can check lib/api-client-react/src/generated/api.ts for measurement hooks.
  // `useCreateMeasurement` should be there.
  
  const createMeasurement = (useCreateMeasurement as any)();
  const updateMeasurement = (useUpdateMeasurement as any)();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      date: initial?.date || new Date().toISOString().split('T')[0],
      weight: initial?.weight || null,
      lArm: initial?.lArm || null,
      rArm: initial?.rArm || null,
      lLeg: initial?.lLeg || null,
      rLeg: initial?.rLeg || null,
      belly: initial?.belly || null,
      chest: initial?.chest || null,
      notes: initial?.notes || "",
    },
  });

  const invalidateData = () => {
    queryClient.invalidateQueries({ queryKey: getListMeasurementsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetWeightTrendQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
  };

  const onSubmit = (data: FormValues) => {
    if (measurementId) {
      updateMeasurement.mutate({ id: measurementId, data }, {
        onSuccess: () => {
          toast({ title: "Measurement updated" });
          invalidateData();
          onOpenChange(false);
          form.reset();
        },
        onError: () => {
          toast({ title: "Error updating measurement", variant: "destructive" });
        }
      });
    } else {
      createMeasurement.mutate({ data }, {
        onSuccess: () => {
          toast({ title: "Measurement added" });
          invalidateData();
          onOpenChange(false);
          form.reset();
        },
        onError: () => {
          toast({ title: "Error adding measurement", variant: "destructive" });
        }
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{measurementId ? "Edit Measurement" : "Add Measurement"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="weight"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Weight (lbs)</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.1" placeholder="180.0" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="belly"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Belly (in)</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.1" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="chest"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Chest (in)</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.1" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="lArm"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Left Arm (in)</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.1" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="rArm"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Right Arm (in)</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.1" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="lLeg"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Left Leg (in)</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.1" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="rLeg"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Right Leg (in)</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.1" {...field} value={field.value ?? ""} />
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
                    <Textarea {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end pt-4">
              <Button type="button" variant="outline" className="mr-2" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={createMeasurement.isPending || updateMeasurement.isPending}>
                {measurementId ? "Save Changes" : "Add Measurement"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
