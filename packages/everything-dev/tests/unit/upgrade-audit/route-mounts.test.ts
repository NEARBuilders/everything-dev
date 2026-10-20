import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateRouteMounts } from "../../../src/services/scaffold/upgrade-audit/steps/migrate-route-mounts";

let projectDir: string;

const run = async (dryRun: boolean) => Effect.runPromise(migrateRouteMounts(projectDir, dryRun));

const readRoute = (name: string) => readFile(join(projectDir, "ui/src/routes", name), "utf-8");

const writeNested = async (relPath: string, content: string) => {
  const full = join(projectDir, "ui/src/routes", relPath);
  await mkdir(full.substring(0, full.lastIndexOf("/")), { recursive: true });
  await writeFile(full, content);
};

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "v2-upgrade-route-mounts-"));
  await mkdir(join(projectDir, "ui/src/routes"), { recursive: true });
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("migrateRouteMounts", () => {
  it("does nothing when no routes are on unknown mounts", async () => {
    await writeNested(
      "_public.tsx",
      'import { createFileRoute, Outlet } from "@tanstack/react-router";\nexport const Route = createFileRoute("/_public")({ component: Outlet });\n',
    );
    await writeNested(
      "_public/index.tsx",
      'import { createFileRoute } from "@tanstack/react-router";\nexport const Route = createFileRoute("/_public/")({ component: () => null });\n',
    );

    const result = await run(false);
    expect(result.writes).toEqual([]);
    expect(result.deletes).toEqual([]);
    expect(result.notes.join("\n")).toContain("no routes on unknown mounts");
  });

  it("rehomes routes from _layout to _public and creates the mount layout", async () => {
    await writeNested(
      "_layout.tsx",
      [
        'import { createFileRoute, Outlet } from "@tanstack/react-router";',
        'export const Route = createFileRoute("/_layout")({ component: Layout });',
        "function Layout() { return <Outlet />; }",
      ].join("\n"),
    );
    await writeNested(
      "_layout/index.tsx",
      'import { createFileRoute } from "@tanstack/react-router";\nexport const Route = createFileRoute("/_layout/")({ component: () => null });\n',
    );
    await writeNested(
      "_layout/login.tsx",
      'import { createFileRoute } from "@tanstack/react-router";\nexport const Route = createFileRoute("/_layout/login")({ component: () => null });\n',
    );

    const result = await run(false);

    // Mount layout created
    expect(result.writes).toContain("ui/src/routes/_public.tsx");
    const publicMount = await readFile(join(projectDir, "ui/src/routes/_public.tsx"), "utf-8");
    expect(publicMount).toContain('"/_public"');
    expect(publicMount).toContain("component: Outlet");

    // Route files moved
    expect(result.deletes).toContain("ui/src/routes/_layout/index.tsx");
    expect(result.deletes).toContain("ui/src/routes/_layout/login.tsx");
    expect(result.deletes).toContain("ui/src/routes/_layout.tsx");

    // New paths in the moved files
    const index = await readRoute("_public/index.tsx");
    expect(index).toContain('createFileRoute("/_public/"');
    const login = await readRoute("_public/login.tsx");
    expect(login).toContain('createFileRoute("/_public/login"');

    // Old files gone
    await expect(
      readFile(join(projectDir, "ui/src/routes/_layout.tsx"), "utf-8"),
    ).rejects.toThrow();
  });

  it("rehomes _layout/_authenticated children to _authenticated/", async () => {
    await writeNested(
      "_layout/_authenticated.tsx",
      [
        'import { createFileRoute, Outlet } from "@tanstack/react-router";',
        'export const Route = createFileRoute("/_layout/_authenticated")({ component: Outlet });',
      ].join("\n"),
    );
    await writeNested(
      "_layout/_authenticated/dashboard.tsx",
      'import { createFileRoute } from "@tanstack/react-router";\nexport const Route = createFileRoute("/_layout/_authenticated/dashboard")({ component: () => null });\n',
    );

    const result = await run(false);

    expect(result.writes).toContain("ui/src/routes/_authenticated.tsx");
    expect(result.deletes).toContain("ui/src/routes/_layout/_authenticated.tsx");
    expect(result.deletes).toContain("ui/src/routes/_layout/_authenticated/dashboard.tsx");

    const dashboard = await readFile(
      join(projectDir, "ui/src/routes/_authenticated/dashboard.tsx"),
      "utf-8",
    );
    expect(dashboard).toContain('"/_authenticated/dashboard"');
  });

  it("dry-run writes nothing", async () => {
    await writeNested(
      "_layout.tsx",
      'import { createFileRoute } from "@tanstack/react-router";\nexport const Route = createFileRoute("/_layout")({ component: () => null });\n',
    );
    await writeNested(
      "_layout/index.tsx",
      'import { createFileRoute } from "@tanstack/react-router";\nexport const Route = createFileRoute("/_layout/")({ component: () => null });\n',
    );

    const beforeIndex = await readFile(
      join(projectDir, "ui/src/routes/_layout/index.tsx"),
      "utf-8",
    );
    await run(true);

    // Nothing written
    await expect(
      readFile(join(projectDir, "ui/src/routes/_public.tsx"), "utf-8"),
    ).rejects.toThrow();
    expect(await readFile(join(projectDir, "ui/src/routes/_layout/index.tsx"), "utf-8")).toBe(
      beforeIndex,
    );
  });

  it("maps unknown mount aliases via MOUNT_ALIASES", async () => {
    // "auth" maps to "authenticated" via MOUNT_ALIASES
    await writeNested(
      "_auth.tsx",
      'import { createFileRoute } from "@tanstack/react-router";\nexport const Route = createFileRoute("/_auth")({ component: () => null });\n',
    );

    const result = await run(false);
    expect(result.writes).toContain("ui/src/routes/_authenticated.tsx");
    const mounted = await readFile(join(projectDir, "ui/src/routes/_authenticated.tsx"), "utf-8");
    expect(mounted).toContain('"/_authenticated"');
  });
});
