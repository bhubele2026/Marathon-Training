import { describe, it, expect, vi } from "vitest";
import type { UseFormReturn } from "react-hook-form";
import {
  applyValidationErrorsToForm,
  extractValidationError,
  type ValidationEnvelope,
} from "./api-errors";

describe("extractValidationError", () => {
  it("returns the envelope from an ApiError-shaped 400 response", () => {
    const apiError = {
      status: 400,
      data: {
        error: {
          formErrors: ["Top-level problem"],
          fieldErrors: {
            rpe: ["Expected number, received string"],
            date: ["Required"],
          },
        },
      },
    };

    expect(extractValidationError(apiError)).toEqual({
      formErrors: ["Top-level problem"],
      fieldErrors: {
        rpe: ["Expected number, received string"],
        date: ["Required"],
      },
    });
  });

  it("returns null for non-400 errors", () => {
    expect(
      extractValidationError({
        status: 500,
        data: {
          error: { formErrors: [], fieldErrors: {} },
        },
      }),
    ).toBeNull();
  });

  it("returns null when the data shape does not match the envelope", () => {
    expect(
      extractValidationError({ status: 400, data: { error: "invalid id" } }),
    ).toBeNull();
    expect(extractValidationError({ status: 400, data: null })).toBeNull();
    expect(
      extractValidationError({ status: 400, data: { error: { formErrors: "nope", fieldErrors: {} } } }),
    ).toBeNull();
  });

  it("returns null for non-object errors", () => {
    expect(extractValidationError(null)).toBeNull();
    expect(extractValidationError(undefined)).toBeNull();
    expect(extractValidationError("boom")).toBeNull();
    expect(extractValidationError(new Error("boom"))).toBeNull();
  });

  it("ignores non-string entries in formErrors and fieldErrors arrays", () => {
    const env = extractValidationError({
      status: 400,
      data: {
        error: {
          formErrors: ["ok", 42, null],
          fieldErrors: {
            rpe: ["Required", 7],
            ignored: "not-an-array",
            empty: [false, null],
          },
        },
      },
    });

    expect(env).toEqual({
      formErrors: ["ok"],
      fieldErrors: {
        rpe: ["Required"],
      },
    });
  });
});

describe("applyValidationErrorsToForm", () => {
  type Values = { date: string; rpe: number | null };

  function makeForm() {
    return {
      setError: vi.fn(),
    } as unknown as UseFormReturn<Values> & { setError: ReturnType<typeof vi.fn> };
  }

  it("calls setError for known fields and returns formErrors verbatim", () => {
    const form = makeForm();
    const envelope: ValidationEnvelope = {
      formErrors: ["Body is missing entirely"],
      fieldErrors: {
        rpe: ["Expected number, received string"],
        date: ["Required"],
      },
    };

    const result = applyValidationErrorsToForm(envelope, form, ["date", "rpe"]);

    expect(form.setError).toHaveBeenCalledTimes(2);
    expect(form.setError).toHaveBeenCalledWith("rpe", {
      type: "server",
      message: "Expected number, received string",
    });
    expect(form.setError).toHaveBeenCalledWith("date", {
      type: "server",
      message: "Required",
    });
    expect(result.formErrors).toEqual(["Body is missing entirely"]);
  });

  it("folds unknown field errors into the returned formErrors banner", () => {
    const form = makeForm();
    const envelope: ValidationEnvelope = {
      formErrors: [],
      fieldErrors: {
        rpe: ["Required"],
        bogusField: ["Unrecognized key"],
      },
    };

    const result = applyValidationErrorsToForm(envelope, form, ["date", "rpe"]);

    expect(form.setError).toHaveBeenCalledTimes(1);
    expect(form.setError).toHaveBeenCalledWith("rpe", {
      type: "server",
      message: "Required",
    });
    expect(result.formErrors).toEqual(["bogusField: Unrecognized key"]);
  });

  it("joins multiple messages for a single field with a comma", () => {
    const form = makeForm();
    const envelope: ValidationEnvelope = {
      formErrors: [],
      fieldErrors: {
        rpe: ["Must be at least 1", "Must be at most 10"],
      },
    };

    applyValidationErrorsToForm(envelope, form, ["date", "rpe"]);

    expect(form.setError).toHaveBeenCalledWith("rpe", {
      type: "server",
      message: "Must be at least 1, Must be at most 10",
    });
  });
});
