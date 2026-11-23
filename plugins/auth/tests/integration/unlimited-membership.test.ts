import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addTestMember,
  createTestHandlers,
  createTestOrg,
  createTestServices,
  createTestUser,
} from "../helpers";

let fixture: Awaited<ReturnType<typeof createTestServices>>;

beforeAll(async () => {
  fixture = await createTestServices({ organizationMembershipLimit: false });
}, 30000);

afterAll(async () => {
  await fixture?.driver.close();
}, 30000);

describe("organization reads with the membership limit off", () => {
  it("loads a full organization and lists members", async () => {
    const owner = await createTestUser(fixture.services);
    const organization = await createTestOrg(fixture.services, owner.userId);
    const member = await createTestUser(fixture.services, {
      email: `unlimited-${crypto.randomUUID()}@example.com`,
    });
    await addTestMember(fixture.services, organization.id, member.userId, "member");

    const handlers = createTestHandlers(fixture.services);

    const full = await handlers.organizations.getFullOrganization({
      input: { organizationId: organization.id },
      context: { reqHeaders: owner.reqHeaders },
    });
    expect(full).not.toBeNull();
    expect(full?.members).toHaveLength(2);

    const listed = await handlers.members.listMembers({
      input: { organizationId: organization.id },
      context: { reqHeaders: owner.reqHeaders },
    });
    expect(listed.members).toHaveLength(2);
    expect(listed.total).toBe(2);
  });
});
