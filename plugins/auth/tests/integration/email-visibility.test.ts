import { describe, expect, it } from "vitest";
import {
  addTestMember,
  createTestHandlers,
  createTestOrg,
  createTestServices,
  createTestUser,
} from "../helpers";

const authOrigin = "http://localhost:3000";

let services: Awaited<ReturnType<typeof createTestServices>>;

function rawGet(path: string, cookie: string) {
  const headers = new Headers({ cookie });
  return new Request(`${authOrigin}/api/auth/${path}`, { method: "GET", headers });
}

describe("email visibility on raw organization routes", () => {
  it("blocks the raw /organization/list-members route", async () => {
    services = await createTestServices();
    const owner = await createTestUser(services.services);
    const org = await createTestOrg(services.services, owner.userId);

    const res = await services.services.auth.handler(
      rawGet(`organization/list-members?organizationId=${org.id}`, owner.cookie),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { message?: string };
    expect(body.message).toMatch(/permission-filtered/i);
  });

  it("redacts member and invitation emails for a caller without email:read", async () => {
    const owner = await createTestUser(services.services);
    const org = await createTestOrg(services.services, owner.userId);
    const member1 = await createTestUser(services.services, {
      email: `e1-${crypto.randomUUID()!.slice(0, 8)}@example.com`,
    });
    const member2 = await createTestUser(services.services, {
      email: `e2-${crypto.randomUUID()!.slice(0, 8)}@example.com`,
    });
    await addTestMember(services.services, org.id, member1.userId, "member");
    await addTestMember(services.services, org.id, member2.userId, "member");
    const handlers = createTestHandlers(services.services);
    await handlers.invitations.inviteMember({
      input: {
        email: `pending-${crypto.randomUUID().slice(0, 8)}@example.com`,
        role: "member",
        organizationId: org.id,
      },
      context: { reqHeaders: owner.reqHeaders },
    });

    const res = await services.services.auth.handler(
      rawGet(`organization/get-full-organization?organizationId=${org.id}`, member1.cookie),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      members: Array<{ userId: string; user: { email: string | null } | null }>;
      invitations: Array<{ email: string | null }>;
    };
    expect(body.id).toBe(org.id);
    for (const member of body.members) {
      if (member.user === null) continue;
      if (member.userId === member1.userId) {
        expect(member.user.email).toBeTruthy();
      } else {
        expect(member.user.email).toBeNull();
      }
    }
    for (const invitation of body.invitations) {
      expect(invitation.email).toBeNull();
    }
  });

  it("keeps member and invitation emails for a caller with email:read", async () => {
    const owner = await createTestUser(services.services);
    const org = await createTestOrg(services.services, owner.userId);
    const member1 = await createTestUser(services.services, {
      email: `o1-${crypto.randomUUID()!.slice(0, 8)}@example.com`,
    });
    await addTestMember(services.services, org.id, member1.userId, "member");
    const handlers = createTestHandlers(services.services);
    const invitedEmail = `pending-${crypto.randomUUID().slice(0, 8)}@example.com`;
    await handlers.invitations.inviteMember({
      input: { email: invitedEmail, role: "member", organizationId: org.id },
      context: { reqHeaders: owner.reqHeaders },
    });

    const res = await services.services.auth.handler(
      rawGet(`organization/get-full-organization?organizationId=${org.id}`, owner.cookie),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      members: Array<{ userId: string; user: { email: string | null } | null }>;
      invitations: Array<{ email: string | null }>;
    };
    expect(body.members).toHaveLength(2);
    for (const member of body.members) {
      expect(member.user?.email).toBeTruthy();
    }
    for (const invitation of body.invitations) {
      expect(invitation.email).toBe(invitedEmail);
    }
  });
});
