import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execa } from "execa";
import { globSync } from "glob";
import { readWorkspaceCatalog } from "../../src/workspace-catalog";

type FrameworkTarballs = {
  "better-near-auth": string;
  "every-plugin": string;
  "everything-dev": string;
};

let tarballsPromise: Promise<FrameworkTarballs> | null = null;

export function getFrameworkTarballs(repoRoot: string): Promise<FrameworkTarballs> {
  tarballsPromise ??= buildFrameworkTarballs(repoRoot);
  return tarballsPromise;
}

async function buildFrameworkTarballs(repoRoot: string): Promise<FrameworkTarballs> {
  const tarballDir = mkdtempSync(join(tmpdir(), "everything-dev-framework-packages-"));

  for (const packageName of ["better-near-auth", "every-plugin", "everything-dev"] as const) {
    await execa("pnpm", ["--dir", `packages/${packageName}`, "run", "build"], { cwd: repoRoot });
  }

  const rootCatalog = readWorkspaceCatalog(repoRoot);

  // The everything-dev tarball depends on the other framework packages and the
  // scaffolded child depends on them directly — both references must use
  // distinct tarball paths, so stage copies for the transitive side. These
  // packages must pack before everything-dev, which consumes the copies.
  const transitiveTarballs: Record<string, string> = {};
  const directTarballs: Record<string, string> = {};
  for (const packageName of ["better-near-auth", "every-plugin"] as const) {
    const tarball = await stageAndPackFrameworkPackage({
      repoRoot,
      packageName,
      tarballDir,
      rootCatalog,
    });
    const copy = join(tarballDir, `${packageName}-transitive-copy.tgz`);
    cpSync(tarball, copy);
    directTarballs[packageName] = tarball;
    transitiveTarballs[packageName] = copy;
  }

  const everythingDevTarball = await stageAndPackFrameworkPackage({
    repoRoot,
    packageName: "everything-dev",
    tarballDir,
    rootCatalog,
    otherFrameworkTarballs: transitiveTarballs,
  });

  return {
    "better-near-auth": directTarballs["better-near-auth"],
    "every-plugin": directTarballs["every-plugin"],
    "everything-dev": everythingDevTarball,
  };
}

async function stageAndPackFrameworkPackage(opts: {
  repoRoot: string;
  packageName: string;
  tarballDir: string;
  rootCatalog: Record<string, string>;
  otherFrameworkTarballs?: Record<string, string>;
}): Promise<string> {
  const sourceDir = join(opts.repoRoot, "packages", opts.packageName);
  const stageDir = mkdtempSync(join(tmpdir(), `${opts.packageName}-pack-stage-`));

  cpSync(sourceDir, stageDir, { recursive: true });
  rmSync(join(stageDir, "tests"), { recursive: true, force: true });

  const packageJsonPath = join(stageDir, "package.json");
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as Record<string, unknown>;

  for (const section of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ] as const) {
    const deps = pkg[section];
    if (!deps || typeof deps !== "object") continue;
    const record = deps as Record<string, string>;
    for (const [name, spec] of Object.entries(record)) {
      if (spec.startsWith("workspace:")) {
        if (opts.otherFrameworkTarballs?.[name]) {
          record[name] = pathToFileURL(opts.otherFrameworkTarballs[name]).href;
        } else if (opts.rootCatalog[name]) {
          record[name] = opts.rootCatalog[name];
        }
      } else if (spec === "catalog:") {
        if (opts.otherFrameworkTarballs?.[name]) {
          record[name] = pathToFileURL(opts.otherFrameworkTarballs[name]).href;
        } else if (opts.rootCatalog[name]) {
          record[name] = opts.rootCatalog[name];
        }
      }
    }
  }

  if (pkg.workspaces && typeof pkg.workspaces === "object") {
    delete (pkg as Record<string, unknown>).workspaces;
  }

  writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);

  const { stdout } = await execa("npm", ["pack", "--pack-destination", opts.tarballDir], {
    cwd: stageDir,
  });
  const tarballName = stdout.trim().split("\n").at(-1);
  if (!tarballName) {
    throw new Error(`npm pack did not return a tarball name for ${opts.packageName}`);
  }

  rmSync(stageDir, { recursive: true, force: true });

  return join(opts.tarballDir, tarballName);
}

export function rewriteFrameworkPackageSpecs(projectDir: string, tarballs: FrameworkTarballs) {
  const packageJsonPaths = globSync("**/package.json", {
    cwd: projectDir,
    nodir: true,
    dot: false,
    absolute: false,
    ignore: ["**/node_modules/**", "**/dist/**", "**/.git/**", "**/.bos/**"],
  });

  for (const packageJsonRel of packageJsonPaths) {
    const packageJsonPath = join(projectDir, packageJsonRel);
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as Record<string, unknown>;
    let changed = false;

    for (const [name, tarballPath] of Object.entries(tarballs)) {
      const spec = pathToFileURL(tarballPath).href;
      for (const section of [
        "dependencies",
        "devDependencies",
        "optionalDependencies",
        "peerDependencies",
      ] as const) {
        const deps = pkg[section];
        if (!deps || typeof deps !== "object") continue;
        const record = deps as Record<string, string>;
        if (!(name in record)) continue;
        record[name] = spec;
        changed = true;
      }
    }

    if (changed) {
      writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
    }
  }
}
