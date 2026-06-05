import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiSpecDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(__dirname, "..", "..", "..");

const apiClientReactSrc = path.resolve(
  repoRoot,
  "lib",
  "api-client-react",
  "src",
);
const apiZodSrc = path.resolve(repoRoot, "lib", "api-zod", "src");

// Each entry compares a committed path against the freshly generated copy in
// the throwaway temp tree. `rel` is the path relative to the output root, used
// to locate the generated counterpart and for human-readable diff labels.
const COMPARISONS: { real: string; rel: string }[] = [
  {
    real: path.join(apiClientReactSrc, "generated"),
    rel: "lib/api-client-react/src/generated",
  },
  {
    real: path.join(apiZodSrc, "generated"),
    rel: "lib/api-zod/src/generated",
  },
  {
    real: path.join(apiZodSrc, "errors.ts"),
    rel: "lib/api-zod/src/errors.ts",
  },
];

type Tree = Map<string, Buffer>;

const SINGLE_FILE_KEY = "";

function readTree(target: string): Tree {
  const tree: Tree = new Map();
  if (!fs.existsSync(target)) return tree;
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    tree.set(SINGLE_FILE_KEY, fs.readFileSync(target));
    return tree;
  }
  function walk(dir: string, prefix: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const sub = path.join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(sub, rel);
      } else if (entry.isFile()) {
        tree.set(rel, fs.readFileSync(sub));
      }
    }
  }
  walk(target, "");
  return tree;
}

function diffTrees(committed: Tree, generated: Tree): string[] {
  const diffs: string[] = [];
  const keys = new Set<string>([...committed.keys(), ...generated.keys()]);
  const sorted = [...keys].sort();
  for (const key of sorted) {
    const a = committed.get(key);
    const b = generated.get(key);
    const label = key === SINGLE_FILE_KEY ? "(file)" : key;
    if (!a && b) {
      diffs.push(`  + ${label} (missing on disk, codegen would create it)`);
    } else if (a && !b) {
      diffs.push(`  - ${label} (committed but codegen no longer emits it)`);
    } else if (a && b && !a.equals(b)) {
      diffs.push(`  ~ ${label} (content differs from spec)`);
    }
  }
  return diffs;
}

function run(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): boolean {
  const result = spawnSync(command, args, {
    cwd: apiSpecDir,
    stdio: "inherit",
    env,
  });
  return result.status === 0;
}

function main(): void {
  // Generate into a throwaway directory so the drift check never deletes or
  // rewrites the committed generated files. orval's `clean: true` would
  // otherwise wipe the output dir mid-run and break any concurrently running
  // dev server importing it (the workspace preview goes blank). We seed the
  // temp tree with a copy of the real source so orval has the mutator
  // (custom-fetch.ts) and surrounding files it needs.
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codegen-check-"));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CODEGEN_OUTPUT_ROOT: tmpRoot,
  };

  let codegenFailed = false;
  let driftDetected = false;

  try {
    fs.cpSync(apiClientReactSrc, path.join(tmpRoot, "lib", "api-client-react", "src"), {
      recursive: true,
    });
    fs.cpSync(apiZodSrc, path.join(tmpRoot, "lib", "api-zod", "src"), {
      recursive: true,
    });

    const tmpErrors = path.join(tmpRoot, "lib", "api-zod", "src", "errors.ts");
    const ok =
      run("pnpm", ["exec", "orval", "--config", "./orval.config.ts"], env) &&
      run("pnpm", ["exec", "tsx", "./scripts/generate-error-zod.ts"], env) &&
      run("pnpm", ["exec", "prettier", "--write", tmpErrors], env);

    if (!ok) {
      codegenFailed = true;
      // eslint-disable-next-line no-console
      console.error(
        "\ncodegen:check: codegen failed. See output above for details.",
      );
    } else {
      const drifted: { rel: string; diffs: string[] }[] = [];
      for (const { real, rel } of COMPARISONS) {
        const committed = readTree(real);
        const generated = readTree(path.join(tmpRoot, rel));
        const diffs = diffTrees(committed, generated);
        if (diffs.length > 0) {
          drifted.push({ rel, diffs });
        }
      }
      if (drifted.length > 0) {
        driftDetected = true;
        // eslint-disable-next-line no-console
        console.error(
          "\ncodegen:check: generated API code is out of date with `lib/api-spec/openapi.yaml`.",
        );
        // eslint-disable-next-line no-console
        console.error(
          "Run the following to regenerate, then commit the result:\n",
        );
        // eslint-disable-next-line no-console
        console.error("  pnpm --filter @workspace/api-spec run codegen\n");
        // eslint-disable-next-line no-console
        console.error("Differences detected:");
        for (const { rel, diffs } of drifted) {
          // eslint-disable-next-line no-console
          console.error(`\n${rel}:`);
          for (const d of diffs) {
            // eslint-disable-next-line no-console
            console.error(d);
          }
        }
      } else {
        // eslint-disable-next-line no-console
        console.log(
          "codegen:check: generated API code is up to date with the OpenAPI spec.",
        );
      }
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  process.exit(codegenFailed || driftDetected ? 1 : 0);
}

main();
