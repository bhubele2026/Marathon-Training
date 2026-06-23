import { useEffect, useState } from "react";
import { useForm, type Path } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { AlertCircle } from "lucide-react";
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
import {
  applyValidationErrorsToForm,
  extractValidationError,
} from "@/lib/api-errors";

const formSchema = z.object({
  date: z.string().min(1, "Date is required"),
  weight: z.coerce.number().optional().nullable(),
  lArm: z.coerce.number().optional().nullable(),
  rArm: z.coerce.number().optional().nullable(),
  lLeg: z.coerce.number().optional().nullable(),
  rLeg: z.coerce.number().optional().nullable(),
  belly: z.coerce.number().optional().nullable(),
  chest: z.coerce.number().optional().nullable(),
  bodyFatPct: z.coerce.number().optional().nullable(),
  notes: z.string().optional().nullable(),
});

type FormValues = z.infer<typeof formSchema>;

const KNOWN_FIELDS = [
  "date",
  "weight",
  "lArm",
  "rArm",
  "lLeg",
  "rLeg",
  "belly",
  "chest",
  "bodyFatPct",
  "notes",
] as const satisfies ReadonlyArray<Path<FormValues>>;

interface MeasurementFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: Partial<Measurement>;
  measurementId?: number;
}

export function MeasurementForm({ open, onOpenChange, initial, measurementId }: MeasurementFormProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createMeasurement = useCreateMeasurement();
  const updateMeasurement = useUpdateMeasurement();
  const [serverFormErrors, setServerFormErrors] = useState<string[]>([]);

  const buildDefaults = (): FormValues => ({
    date: initial?.date || new Date().toISOString().split('T')[0],
    weight: initial?.weight ?? null,
    lArm: initial?.lArm ?? null,
    rArm: initial?.rArm ?? null,
    lLeg: initial?.lLeg ?? null,
    rLeg: initial?.rLeg ?? null,
    belly: initial?.belly ?? null,
    chest: initial?.chest ?? null,
    bodyFatPct: initial?.bodyFatPct ?? null,
    notes: initial?.notes || "",
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
  }, [open, initial?.date, measurementId]);

  const invalidateData = () => {
    queryClient.invalidateQueries({ queryKey: getListMeasurementsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetWeightTrendQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
  };

  const handleMutationError = (error: unknown, fallbackTitle: string) => {
    const envelope = extractValidationError(error);
    if (envelope) {
      const { formErrors } = applyValidationErrorsToForm(envelope, form, KNOWN_FIELDS);
      setServerFormErrors(formErrors);
      toast({
        title: "Please fix the highlighted fields",
        description:
          formErrors[0] ??
          "The server rejected this measurement. Check the form for details.",
        variant: "destructive",
      });
      return;
    }
    setServerFormErrors([]);
    toast({ title: fallbackTitle, variant: "destructive" });
  };

  const onSubmit = (data: FormValues) => {
    setServerFormErrors([]);
    if (measurementId) {
      updateMeasurement.mutate({ id: measurementId, data }, {
        onSuccess: () => {
          toast({ title: "Measurement updated" });
          invalidateData();
          onOpenChange(false);
          form.reset();
        },
        onError: (error) => {
          handleMutationError(error, "Error updating measurement");
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
        onError: (error) => {
          handleMutationError(error, "Error adding measurement");
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
            {serverFormErrors.length > 0 && (
              <Alert variant="destructive" data-testid="measurement-form-errors">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>We couldn't save this measurement</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-4 space-y-1">
                    {serverFormErrors.map((message, idx) => (
                      <li key={idx}>{message}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
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
                name="bodyFatPct"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Body Fat (%)</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.1" placeholder="22.5" {...field} value={field.value ?? ""} />
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
