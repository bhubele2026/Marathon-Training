import * as zod from "zod";

/**
 * Hand-authored zod mirror of the `Error` and `ValidationError` component
 * schemas in `lib/api-spec/openapi.yaml`.
 *
 * Orval's zod client only emits schemas for 2xx responses, so the 4xx
 * response schemas referenced from the OpenAPI spec do not show up in
 * `./generated/api.ts`. We mirror them here so server tests can still call
 * `expectMatchesSchema(ErrorResponse, res.body)` against 4xx bodies and
 * catch error-envelope drift the same way success-shape drift is caught.
 *
 * Keep these in sync with `components.schemas.Error` and
 * `components.schemas.ValidationError` in the OpenAPI spec. The generated
 * `Error` / `ValidationError` TypeScript types in
 * `lib/api-client-react/src/generated/api.schemas.ts` are the canonical
 * shape the React client sees.
 */

export const ErrorResponse = zod.object({
  error: zod.string(),
});

export const ValidationErrorResponse = zod.object({
  error: zod.object({
    formErrors: zod.array(zod.string()),
    fieldErrors: zod.record(zod.string(), zod.array(zod.string())),
  }),
});
