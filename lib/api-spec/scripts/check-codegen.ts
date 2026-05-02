import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..");

const TARGETS = [
  path.resolve(repoRoot, "lib", "api-client-react", "src", "generated"),
  path.resolve(repoRoot, "lib", "api-zod", "src", "generated"),
  path.resolve(repoRoot, "lib", "api-zod", "src", "errors.ts"),
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

function restoreTree(target: string, tree: Tree): void {
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
  if (tree.size === 0) {
    return;
  }
  if (tree.size === 1 && tree.has(SINGLE_FILE_KEY)) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, tree.get(SINGLE_FILE_KEY)!);
    return;
  }
  fs.mkdirSync(target, { recursive: true });
  for (const [rel, content] of tree) {
    const dest = path.join(target, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
  }
}

function diffTrees(before: Tree, after: Tree): string[] {
  const diffs: string[] = [];
  const keys = new Set<string>([...before.keys(), ...after.keys()]);
  const sorted = [...keys].sort();
  for (const key of sorted) {
    const a = before.get(key);
    const b = after.get(key);
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

function main(): void {
  const snapshots = TARGETS.map((target) => ({
    target,
    tree: readTree(target),
  }));

  let codegenFailed = false;
  let driftDetected = false;
  let restoreFailed = false;

  try {
    const result = spawnSync(
      "pnpm",
      ["--filter", "@workspace/api-spec", "run", "codegen:generate"],
      {
        cwd: repoRoot,
        stdio: "inherit",
      },
    );
    if (result.status !== 0) {
      codegenFailed = true;
      // eslint-disable-next-line no-console
      console.error(
        "\ncodegen:check: codegen failed. See output above for details.",
      );
    } else {
      const drifted: { target: string; diffs: string[] }[] = [];
      for (const { target, tree } of snapshots) {
        const after = readTree(target);
        const diffs = diffTrees(tree, after);
        if (diffs.length > 0) {
          drifted.push({ target, diffs });
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
        for (const { target, diffs } of drifted) {
          // eslint-disable-next-line no-console
          console.error(`\n${path.relative(repoRoot, target)}:`);
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
    for (const { target, tree } of snapshots) {
      try {
        restoreTree(target, tree);
      } catch (err) {
        restoreFailed = true;
        // eslint-disable-next-line no-console
        console.error(
          `codegen:check: failed to restore snapshot for ${path.relative(
            repoRoot,
            target,
          )}: ${(err as Error).message}`,
        );
      }
    }
    if (restoreFailed) {
      // eslint-disable-next-line no-console
      console.error(
        "\ncodegen:check: working tree may be in an inconsistent state. " +
          "Run `pnpm --filter @workspace/api-spec run codegen` to regenerate, " +
          "then verify with `git status`.",
      );
    }
  }

  process.exit(codegenFailed || driftDetected || restoreFailed ? 1 : 0);
}

main();
