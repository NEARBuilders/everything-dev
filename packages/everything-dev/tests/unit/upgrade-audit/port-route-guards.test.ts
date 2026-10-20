import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { portRouteGuards } from "../../../src/services/scaffold/upgrade-audit/steps/port-route-guards";
import { UPSTREAM_REF } from "../../../src/services/scaffold/upgrade-audit/upstream-ref";

// Tree with the pre-port guard shapes: inline session resolution on the
// authed mount and a root with the raw session pass-through — the exact
// precondition of the redirect-loop class.
let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "v2-upgrade-port-guards-"));
  await mkdir(join(projectDir, "ui/src/routes"), { recursive: true });
  await writeFile(
    join(projectDir, "ui/src/routes/_authenticated.tsx"),
    [
      'import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";',
      'import { sessionQueryOptions } from "@/app";',
      "",
      'export const Route = createFileRoute("/_authenticated")({',
      "  beforeLoad: async ({ context, location }) => {",
      "    const session = await context.queryClient.fetchQuery(",
      "      sessionQueryOptions(context.authClient, context.session),",
      "    );",
      "    if (!session?.user) throw redirect({ to: '/login', search: { redirect: location.href } });",
      "  },",
      "  component: () => <Outlet />",
      "});",
      "",
    ].join("\n"),
  );
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

const run = async (dryRun: boolean) => Effect.runPromise(portRouteGuards(projectDir, dryRun));

const readRoute = (name: string) => readFile(join(projectDir, "ui/src/routes", name), "utf-8");

describe("portRouteGuards", () => {
  it("writes mount files that delegate to the framework guard", async () => {
    await writeFile(join(projectDir, "ui/src/routes/__root.tsx"), "export const noop = 1;\n");
    const result = await run(false);
    expect(result.writes).toContain("ui/src/routes/_authenticated.tsx");
  });

  it("rewrites the inline resolution to a requireSession delegation", async () => {
    await run(false);
    const source = await readRoute("_authenticated.tsx");
    expect(source).toContain("beforeLoad: requireSession,");
    expect(source).toContain('"everything-dev/ui/auth"');
    expect(source).not.toContain("sessionQueryOptions");
  });

  it("does not write on dry-run", async () => {
    const before = await readRoute("_authenticated.tsx");
    await run(true);
    expect(await readRoute("_authenticated.tsx")).toBe(before);
  });

  it("skips when the mount already delegates", async () => {
    await run(false);
    const result = await run(false);
    expect(result.writes).toEqual([]);
    expect(result.notes.join("\n")).toMatch(/already delegates to the framework guard/);
  });

  it("patches the root session wiring with explicit signed-out seeding", async () => {
    await writeFile(
      join(projectDir, "ui/src/routes/__root.tsx"),
      [
        "export const Route = createRootRouteWithContext<RouterContext>()({",
        "  beforeLoad: async ({ context }) => {",
        "    const session = context.session;",
        "    return { runtimeConfig: context.runtimeConfig, cspNonce: context.cspNonce, session };",
        "  },",
        "  loader: async ({ context }) => {",
        "    const { queryClient } = context;",
        "    const session = context.session;",
        "    if (session && queryClient) {",
        "      queryClient.setQueryData(sessionQueryKey, session);",
        "    }",
        "    return { runtimeConfig: context.runtimeConfig, cspNonce: context.cspNonce, session };",
        "  },",
        "});",
        "",
      ].join("\n"),
    );

    const result = await run(false);
    expect(result.writes).toContain("ui/src/routes/__root.tsx");
    const after = await readRoute("__root.tsx");
    expect(after).toContain("resolveSessionFromCache(context.queryClient, context.session)");
    expect(after).toContain(
      "const session = resolveSessionFromCache(queryClient, context.session);",
    );
    expect(after).toContain("if (session !== undefined && queryClient) {");
    expect(after).toContain('import { resolveSessionFromCache } from "everything-dev/ui/auth";');
    expect(after).not.toContain("const session = context.session;");
  });

  it("leaves the app-owned root chrome alone", async () => {
    await writeFile(
      join(projectDir, "ui/src/routes/__root.tsx"),
      [
        'import { FeedbackWidget } from "@/components";',
        'export const chrome = <FeedbackWidget projectSlug="feedback" />;',
        "export const Route = createRootRouteWithContext<RouterContext>()({",
        "  beforeLoad: async ({ context }) => {",
        "    const session = context.session;",
        "    return { session };",
        "  },",
        "});",
        "",
      ].join("\n"),
    );
    const result = await run(false);
    expect(result.writes).toContain("ui/src/routes/__root.tsx");
    expect(await readRoute("__root.tsx")).toContain(
      'import { FeedbackWidget } from "@/components";',
    );
  });

  it("records the pinned upstream snapshots in its notes", async () => {
    const result = await run(true);
    expect(result.notes.join("\n")).toContain(UPSTREAM_REF);
  });
});
