import { call, os } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { type AuthContextShape, createAuthMiddleware } from "../../src/api/auth-middleware";

describe("organization approval middleware", () => {
  const builder = os.$context<AuthContextShape>();
  const { requireOrganization, requireOrgRole } = createAuthMiddleware(builder);
  const routes = [
    builder
      .use(requireOrganization)
      .handler(({ context }) => context.organization.activeOrganizationId),
    builder
      .use(requireOrgRole("owner"))
      .handler(({ context }) => context.organization.activeOrganizationId),
  ];

  function context(status?: string): AuthContextShape {
    return {
      userId: "requester",
      user: { role: "admin" },
      organization: {
        activeOrganizationId: "requested-org",
        organization: { status },
        member: { id: "requester-membership", role: "owner" },
      },
    };
  }

  it.each([
    "pending",
    "rejected",
  ])("blocks %s organizations even for a platform admin and owner", async (status) => {
    for (const route of routes) {
      await expect(call(route, undefined, { context: context(status) })).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: "Organization requires platform-admin approval",
      });
    }
  });

  it.each(["active", undefined])("permits approved and legacy contexts: %s", async (status) => {
    for (const route of routes) {
      await expect(call(route, undefined, { context: context(status) })).resolves.toBe(
        "requested-org",
      );
    }
  });

  it("requires authentication and a selected organization", async () => {
    await expect(call(routes[0], undefined, { context: {} })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      call(routes[0], undefined, { context: { userId: "requester", user: {} } }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("requirePermission", () => {
  const builder = os.$context<AuthContextShape>();
  const { requirePermission } = createAuthMiddleware(builder);

  const orgRoute = builder.use(requirePermission("proposal", "create")).handler(() => "ok");

  const orgContext = {
    userId: "requester",
    user: {},
    permissions: { proposal: ["create"], team: ["read"] },
    organization: {
      activeOrganizationId: "org-1",
      teams: [
        { id: "team-1", permissions: { team: ["update"] } },
        { id: "team-2", permissions: { team: [] } },
      ],
    },
  };

  it("allows org-scoped actions the effective permissions grant", async () => {
    await expect(call(orgRoute, undefined, { context: orgContext })).resolves.toBe("ok");
  });

  const teamRoute = builder
    .input(z.object({ teamId: z.string() }))
    .use(
      requirePermission("team", "update", {
        scope: "team",
        teamId: (input: { teamId?: string } | undefined) => input?.teamId,
      }),
    )
    .handler(() => "ok");

  it("allows team-scoped actions via the caller's team grants", async () => {
    await expect(call(teamRoute, { teamId: "team-1" }, { context: orgContext })).resolves.toBe(
      "ok",
    );
  });

  it("denies team-scoped actions when the team is not the caller's or lacks the grant", async () => {
    await expect(
      call(teamRoute, { teamId: "team-2" }, { context: orgContext }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      call(teamRoute, { teamId: "other-team" }, { context: orgContext }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("denies org-scoped actions with the missing grant in the data payload", async () => {
    await expect(
      call(orgRoute, undefined, {
        context: { ...orgContext, permissions: { proposal: ["read"] } },
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      data: { requiredPermissions: ["proposal:create"] },
    });
    await expect(call(orgRoute, undefined, { context: {} })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
