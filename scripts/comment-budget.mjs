#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import { parseSync } from "oxc-parser";

const BASELINE = "scripts/comment-budget.baseline.json";
const EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const SKIP_DIRS = [
  "node_modules/",
  "dist/",
  ".bos/",
  ".velite/",
  "repos/",
  ".agents/skills/",
  "docs/plans/prototypes/",
];

const DIRECTIVES = [
  "<reference",
  "@ts-ignore",
  "@ts-expect-error",
  "@ts-nocheck",
  "@ts-check",
  "@jsx",
  "@vitest-environment",
  "@jest-environment",
  "@effect-diagnostics",
  "eslint-disable",
  "eslint-enable",
  "eslint-env",
  "oxlint-disable",
  "oxlint-enable",
  "biome-ignore",
  "prettier-ignore",
  "istanbul ignore",
  "c8 ignore",
  "v8 ignore",
  "sourceMappingURL",
  "@generated",
  "@noformat",
  "@format",
  "#region",
  "#endregion",
];

const isDirective = (value) => DIRECTIVES.some((marker) => value.includes(marker));

const listFiles = () => {
  const tracked = execFileSync("git", ["ls-files", "-z"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter(Boolean);
  return tracked.filter(
    (file) =>
      EXTENSIONS.has(extname(file)) &&
      !SKIP_DIRS.some((dir) => file.startsWith(dir)) &&
      !/\/types\/contract\.d\.ts$/.test(file),
  );
};

const lineIndex = (buffer) => {
  const starts = [0];
  for (let i = 0; i < buffer.length; i += 1) {
    if (buffer[i] === 10) starts.push(i + 1);
  }
  return starts;
};

const lineAt = (starts, offset) => {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return low + 1;
};

const readComments = (file, source = readFileSync(file, "utf8")) => {
  const parsed = parseSync(file, source);
  const fatal = (parsed.errors ?? []).filter((error) => error.severity === "Error");
  if (fatal.length > 0) return { error: fatal[0].message, comments: [] };
  const buffer = Buffer.from(source, "utf8");
  const starts = lineIndex(buffer);
  return {
    comments: (parsed.comments ?? []).map((comment) => {
      const startLine = lineAt(starts, comment.start);
      const endLine = lineAt(starts, Math.max(comment.start, comment.end - 1));
      return {
        line: startLine,
        lines: endLine - startLine + 1,
        text: comment.value.trim(),
        directive: isDirective(comment.value) || (comment.start === 0 && source.startsWith("#!")),
      };
    }),
  };
};

const measure = (files) => {
  const rows = [];
  for (const file of files) {
    const { comments, error } = readComments(file);
    if (error) {
      rows.push({ file, prose: 0, directives: 0, error });
      continue;
    }
    const prose = comments.filter((comment) => !comment.directive);
    rows.push({
      file,
      prose: prose.reduce((total, comment) => total + comment.lines, 0),
      directives: comments.length - prose.length,
      comments: prose,
    });
  }
  return rows;
};

const readBaseline = () =>
  existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")).files : {};

const gitRun = (args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });

const mergeBase = () => {
  try {
    return gitRun(["merge-base", "origin/main", "HEAD"]).trim();
  } catch {
    try {
      const parents = gitRun(["rev-list", "--parents", "-n", "1", "HEAD"]).trim().split(" ");
      return parents.length > 2 ? parents[1] : null;
    } catch {
      return null;
    }
  }
};

const prSurface = (base) => {
  if (base === null) return null;
  try {
    return gitRun(["diff", "--name-only", `${base}..HEAD`]).split("\n");
  } catch {
    return null;
  }
};

const proseAt = (ref, file) => {
  try {
    const source = gitRun(["show", `${ref}:${file}`]);
    const { comments, error } = readComments(file, source);
    if (error) return null;
    return comments
      .filter((comment) => !comment.directive)
      .reduce((total, comment) => total + comment.lines, 0);
  } catch {
    return null;
  }
};

const area = (file) => {
  const [top] = file.split("/");
  return file.includes("/") ? top : "(root)";
};

const runCheck = () => {
  const baseline = readBaseline();
  const rows = measure(listFiles());
  const over = [];
  const added = [];
  const adopted = [];
  const errors = [];
  const base = mergeBase();
  const surface = prSurface(base);
  const surfaceSet = surface === null ? null : new Set(surface);

  for (const row of rows) {
    if (row.error) {
      errors.push(`${row.file}: ${row.error}`);
      continue;
    }
    const budget = baseline[row.file];
    if (budget === undefined) {
      if (row.prose === 0) continue;
      if (surfaceSet === null || surfaceSet.has(row.file)) added.push(row);
      else adopted.push(`${row.file} — ${row.prose} comment line(s)`);
      continue;
    }
    if (row.prose > budget) {
      const baseCount = base === null ? null : proseAt(base, row.file);
      if (baseCount !== null && baseCount > budget) {
        adopted.push(`${row.file} — grew ${budget} → ${row.prose} on the base branch`);
        continue;
      }
      over.push({ ...row, budget });
    }
  }

  const seen = new Set(rows.map((row) => row.file));
  const gone = Object.keys(baseline).filter((file) => !seen.has(file));

  for (const row of added) {
    console.error(`✗ ${row.file}: ${row.prose} comment line(s) — new files start at zero`);
  }
  for (const row of over) {
    console.error(`✗ ${row.file}: ${row.prose} comment lines, budget ${row.budget}`);
  }
  for (const file of gone) {
    console.log(`- ${file}: in baseline but no longer tracked (run --update to prune)`);
  }
  for (const entry of adopted) {
    console.log(`- ${entry} (carried in from the base branch — run --update to absorb)`);
  }
  for (const message of errors) {
    console.error(`! unparseable, skipped: ${message}`);
  }

  if (added.length + over.length > 0) {
    const total = rows.reduce((sum, row) => sum + row.prose, 0);
    console.error(
      `\n${added.length + over.length} file(s) over budget. ` +
        `Delete the comments (move decisions to an ADR) or run \`pnpm run lint:comments -- --update\` ` +
        `only to ratchet the baseline down. Repo total: ${total} prose comment lines.`,
    );
    process.exitCode = 1;
    return;
  }

  const total = rows.reduce((sum, row) => sum + row.prose, 0);
  console.log(`comment budget holds — ${total} prose comment lines across ${rows.length} files`);
};

const runUpdate = () => {
  const rows = measure(listFiles());
  const files = {};
  for (const row of rows) {
    if (row.prose > 0) files[row.file] = row.prose;
  }
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(BASELINE, `${JSON.stringify({ files: sorted }, null, 2)}\n`);
  const total = rows.reduce((sum, row) => sum + row.prose, 0);
  console.log(`wrote ${BASELINE} — ${Object.keys(sorted).length} files, ${total} lines`);
};

const runList = (paths) => {
  const files = paths.length > 0 ? paths : listFiles();
  const rows = measure(files);
  for (const row of rows) {
    if (row.prose === 0) continue;
    console.log(`\n${row.file} — ${row.prose} line(s)`);
    for (const comment of row.comments ?? []) {
      const first = comment.text.split("\n")[0].slice(0, 140);
      console.log(
        `  ${row.file}:${comment.line}  ${comment.lines > 1 ? `[${comment.lines}L] ` : ""}${first}`,
      );
    }
  }
};

const runEstimate = () => {
  const baseline = readBaseline();
  const rows = measure(listFiles());
  const total = rows.reduce((sum, row) => sum + row.prose, 0);
  const directives = rows.reduce((sum, row) => sum + row.directives, 0);
  const budgeted = rows.filter((row) => row.prose > 0);
  const byArea = {};
  for (const row of rows) {
    if (row.prose === 0) continue;
    const key = area(row.file);
    byArea[key] = (byArea[key] ?? 0) + row.prose;
  }
  console.log(`prose comment lines: ${total}`);
  console.log(`directive comments kept: ${directives}`);
  console.log(`files carrying prose: ${budgeted.length}`);
  console.log(`baseline entries: ${Object.keys(baseline).length}`);
  console.log("\nby area:");
  for (const [key, value] of Object.entries(byArea).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${key.padEnd(14)} ${value}`);
  }
  console.log("\nhot spots:");
  for (const row of [...budgeted].sort((a, b) => b.prose - a.prose).slice(0, 15)) {
    console.log(`  ${String(row.prose).padStart(5)}  ${row.file}`);
  }
};

const [mode = "--check", ...rest] = process.argv.slice(2);
if (mode === "--check") runCheck();
else if (mode === "--update") runUpdate();
else if (mode === "--list") runList(rest);
else if (mode === "--estimate") runEstimate();
else if (mode === "--help" || mode === "-h") {
  console.log(`usage: comment-budget [--check | --update | --list <files...> | --estimate]

  --check      fail when any file exceeds its budget (default)
  --update     rewrite the baseline from the working tree (ratchet down only)
  --list       print every budgeted comment with file:line for auditing
  --estimate   print totals, hot spots, and the projected shed

Prose comments are counted per file; directive comments (tooling
instructions the compiler or linter reads) are never counted.`);
} else {
  console.error(`unknown mode ${mode} (use --check, --update, --list, --estimate)`);
  process.exitCode = 2;
}
