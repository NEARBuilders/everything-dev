import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Newest mtime under src (recursive) — the staleness oracle for the ui dist. */
function newestSourceMtime(srcDir: string, floor = 0): number {
  let newest = floor;
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const full = path.join(srcDir, entry.name);
    if (entry.isDirectory()) {
      newest = newestSourceMtime(full, newest);
    } else {
      newest = Math.max(newest, statSync(full).mtimeMs);
    }
  }
  return newest;
}

/**
 * The hashed entry name a dist root's build report names (atomic-deploys
 * builds emit content-hashed entries; the report is the discovery contract).
 * Empty when the dist predates hashed entries (or the named file is gone).
 */
function reportedEntry(distRoot: string): string {
  const reportPath = path.join(distRoot, "build-report.json");
  if (!existsSync(reportPath)) return "";
  try {
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as { entry?: string };
    const entry = typeof report.entry === "string" ? report.entry : "";
    return entry && existsSync(path.join(distRoot, entry)) ? entry : "";
  } catch {
    return "";
  }
}

function ensureUiBuild(repoRoot: string) {
  const uiDir = path.join(repoRoot, "ui");
  const distDir = path.join(uiDir, "dist");
  const srcDir = path.join(uiDir, "src");
  const clientEntry = reportedEntry(distDir);
  const ssrEntry = reportedEntry(path.join(distDir, "ssr"));

  // A dist that predates any src file is stale — same missing-or-stale
  // contract the build train applies to its quiet prerequisites.
  const stale =
    existsSync(srcDir) &&
    newestSourceMtime(srcDir) >
      (clientEntry ? statSync(path.join(distDir, clientEntry)).mtimeMs : 0);

  if (clientEntry && ssrEntry && !stale) return;

  // Build the ui directly, NOT through the build train: `bos build` forces
  // NODE_ENV=development (only --deploy flips it), which bakes the dev-server
  // assetPrefix (http://localhost:3003/) into the SSR container — host tests
  // then fetch shared deps from a dev port nothing listens on. The host test
  // script runs NODE_ENV=production (production-mode host code paths), and the
  // inherited env gives the SSR dist the asset-less public path it needs.
  // Framework sources resolve from src in tests (vite-tsconfig-paths), so no
  // train prerequisites are required here.
  const result = spawnSync("pnpm", ["run", "build"], {
    cwd: uiDir,
    stdio: "inherit",
    env: { ...process.env },
  });
  if (result.status !== 0) {
    throw new Error(`UI build failed (exit ${result.status ?? "unknown"})`);
  }
}

export default async function globalSetup() {
  const repoRoot = path.resolve(__dirname, "../..");

  ensureUiBuild(repoRoot);
}
