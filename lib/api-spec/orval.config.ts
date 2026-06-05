import { defineConfig, InputTransformerFn } from "orval";
import path from "path";

const root = path.resolve(__dirname, "..", "..");

// When CODEGEN_OUTPUT_ROOT is set (used by codegen:check), all generated
// output is redirected under that root instead of the committed working tree.
// This keeps the drift check from deleting/rewriting the live generated files
// that the running dev servers import (orval's `clean: true` would otherwise
// blank the output dir mid-flight and break a concurrent vite dev server).
const outputRoot = process.env.CODEGEN_OUTPUT_ROOT
  ? path.resolve(process.env.CODEGEN_OUTPUT_ROOT)
  : root;
const apiClientReactSrc = path.resolve(
  outputRoot,
  "lib",
  "api-client-react",
  "src",
);
const apiZodSrc = path.resolve(outputRoot, "lib", "api-zod", "src");

// Our exports make assumptions about the title of the API being "Api" (i.e. generated output is `api.ts`).
const titleTransformer: InputTransformerFn = (config) => {
  config.info ??= {};
  config.info.title = "Api";

  return config;
};

export default defineConfig({
  "api-client-react": {
    input: {
      target: "./openapi.yaml",
      override: {
        transformer: titleTransformer,
      },
    },
    output: {
      workspace: apiClientReactSrc,
      target: "generated",
      client: "react-query",
      mode: "split",
      baseUrl: "/api",
      clean: true,
      prettier: true,
      override: {
        fetch: {
          includeHttpResponseReturnType: false,
        },
        mutator: {
          path: path.resolve(apiClientReactSrc, "custom-fetch.ts"),
          name: "customFetch",
        },
      },
    },
  },
  zod: {
    input: {
      target: "./openapi.yaml",
      override: {
        transformer: titleTransformer,
      },
    },
    output: {
      workspace: apiZodSrc,
      client: "zod",
      target: "generated",
      mode: "split",
      clean: true,
      prettier: true,
      indexFiles: false,
      override: {
        zod: {
          coerce: {
            query: ['boolean', 'number', 'string'],
            param: ['boolean', 'number', 'string'],
            body: ['bigint', 'date'],
            response: ['bigint', 'date'],
          },
        },
        useDates: true,
        useBigInt: true,
      },
    },
  },
});
