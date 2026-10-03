import { call, os } from "@orpc/server";
import { describe, expect, it } from "vitest";
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
