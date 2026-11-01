import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { checkRouteGuards } from "../../../src/services/scaffold/upgrade-audit/checks/route-guards";
import { warnMessages } from "./test-helpers";

let projectDir: string;

const writeRoute = (name: string, content: string) =>
  writeFile(join(projectDir, "ui/src/routes", name), content);

const switchFixture = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "v2-upgrade-guards-"));
  await mkdir(join(dir, "ui/src/routes"), { recursive: true });
  return dir;
};

describe("checkRouteGuards", () => {
  it("passes a tree that delegates to the framework guard surface", async () => {
    projectDir = await switchFixture();
    await writeRoute(
      "_authenticated.tsx",
      [
        'import { createFileRoute, Outlet } from "@tanstack/react-router";',
        'import { requireSession } from "everything-dev/ui/auth";',
        "",
        'export const Route = createFileRoute("/_authenticated")({',
        "  beforeLoad: requireSession,",
        "  component: () => <Outlet />;",
        "});",
        "",
      ].join("\n"),
    );
    await writeRoute(
      "__root.tsx",
      [
        'import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";',
        'import { resolveSessionFromCache } from "everything-dev/ui/auth";',
        "",
        "export const Route = createRootRouteWithContext<RouterContext>()({",
        "  beforeLoad: async ({ context }) => {",
        "    const session = resolveSessionFromCache(context.queryClient, context.session);",
        "    return { session };",
        "  },",
        "  component: Outlet,",
        "});",
        "",
      ].join("\n"),
    );

    const findings = await Effect.runPromise(checkRouteGuards(projectDir));
    expect(findings).toEqual([]);
    await rm(projectDir, { recursive: true, force: true });
  });

  it("flags an authed mount that resolves the session inline", async () => {
    projectDir = await switchFixture();
    await writeRoute(
      "_authenticated.tsx",
      [
        'import { createFileRoute } from "@tanstack/react-router";',
        'import { sessionQueryOptions, useAuthClient } from "@/app";',
        "",
        'export const Route = createFileRoute("/_authenticated")({',
        "  beforeLoad: async ({ context }) => {",
        "    const session = await context.queryClient.fetchQuery(",
        "      sessionQueryOptions(context.authClient, context.session),",
        "    );",
        "  },",
        "});",
        "",
      ].join("\n"),
    );
    await writeRoute(
      "__root.tsx",
      "export const Route = createRootRouteWithContext<RouterContext>()({});\n",
    );

    const findings = await Effect.runPromise(checkRouteGuards(projectDir));
    expect(warnMessages(findings).join("\n")).toMatch(
      /authed mount "_authenticated" resolves the session inline.*requireSession/,
    );
    await rm(projectDir, { recursive: true, force: true });
  });

  it("flags a root that passes the raw context.session through", async () => {
    projectDir = await switchFixture();
    await writeRoute(
      "_authenticated.tsx",
      'export const Route = createFileRoute("/_authenticated")({});\n',
    );
    await writeRoute(
      "__root.tsx",
      [
        'import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";',
        "",
        "export const Route = createRootRouteWithContext<RouterContext>()({",
        "  beforeLoad: async ({ context }) => {",
        "    const session = context.session;",
        "    return { session };",
        "  },",
        "  component: Outlet,",
        "});",
        "",
      ].join("\n"),
    );

    const findings = await Effect.runPromise(checkRouteGuards(projectDir));
    expect(warnMessages(findings).join("\n")).toMatch(
      /root passes the raw context\.session through/,
    );
    await rm(projectDir, { recursive: true, force: true });
  });
});
