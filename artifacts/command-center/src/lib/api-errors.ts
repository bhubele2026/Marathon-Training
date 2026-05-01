import type { FieldValues, Path, UseFormReturn } from "react-hook-form";
import type {
  ValidationError,
  ValidationErrorError,
} from "@workspace/api-client-react";

/**
 * Runtime-safe view of the server's `ValidationError.error` payload (the
 * structured body produced by Zod's `flatten()`). The generated
 * {@link ValidationErrorError} interface guarantees the field names and
 * value types we project here, but we still re-validate at runtime because
 * the payload arrives via `unknown` from the network layer.
 */
export type ValidationEnvelope = ValidationErrorError;

export function extractValidationError(error: unknown): ValidationEnvelope | null {
  if (!error || typeof error !== "object") return null;

  const status = (error as { status?: unknown }).status;
  if (status !== 400) return null;

  const data = (error as { data?: unknown }).data as Partial<ValidationError> | null | undefined;
  if (!data || typeof data !== "object") return null;

  const envelope = data.error as unknown;
  if (!envelope || typeof envelope !== "object") return null;

  const formErrorsRaw = (envelope as { formErrors?: unknown }).formErrors;
  const fieldErrorsRaw = (envelope as { fieldErrors?: unknown }).fieldErrors;

  if (!Array.isArray(formErrorsRaw)) return null;
  if (!fieldErrorsRaw || typeof fieldErrorsRaw !== "object") return null;

  const formErrors = formErrorsRaw.filter((m): m is string => typeof m === "string");
  const fieldErrors: ValidationErrorError["fieldErrors"] = {};
  for (const [field, messages] of Object.entries(fieldErrorsRaw as Record<string, unknown>)) {
    if (!Array.isArray(messages)) continue;
    const filtered = messages.filter((m): m is string => typeof m === "string");
    if (filtered.length > 0) fieldErrors[field] = filtered;
  }

  return { formErrors, fieldErrors };
}

export type ApplyValidationErrorsResult = {
  formErrors: string[];
};

export function applyValidationErrorsToForm<TValues extends FieldValues>(
  envelope: ValidationEnvelope,
  form: UseFormReturn<TValues>,
  knownFields: ReadonlyArray<Path<TValues>>,
): ApplyValidationErrorsResult {
  const known = new Set<string>(knownFields as readonly string[]);
  const extraFormErrors: string[] = [];

  for (const [field, messages] of Object.entries(envelope.fieldErrors)) {
    const message = messages.join(", ");
    if (known.has(field)) {
      form.setError(field as Path<TValues>, { type: "server", message });
    } else {
      extraFormErrors.push(`${field}: ${message}`);
    }
  }

  return { formErrors: [...envelope.formErrors, ...extraFormErrors] };
}
