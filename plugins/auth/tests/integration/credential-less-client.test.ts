import { describe, expect, it } from "vitest";
import { createTestHandlers, createTestServices, createTestUser } from "../helpers";

describe("credential-less in-process client (the #860 repro)", () => {
  it("names the missing forwarded credentials instead of apiKeyProvided prose", async () => {
    const { services } = await createTestServices();
    const user = await createTestUser(services);
    const handlers = createTestHandlers(services);

    await expect(
      handlers.organizations.listOrganizations({
        context: { userId: user.userId } as unknown as { reqHeaders?: Record<string, string> },
      }),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: expect.stringMatching(/forwarded no credentials/),
      data: { apiKeyProvided: false },
    });
  });

  it("message points at reqHeaders forwarding as the fix", async () => {
    const { services } = await createTestServices();
    const user = await createTestUser(services);
    const handlers = createTestHandlers(services);

    const error = (await handlers.organizations
      .listOrganizations({
        context: { userId: user.userId } as unknown as { reqHeaders?: Record<string, string> },
      })
      .catch((caught: unknown) => caught)) as Error;

    expect(error.message).toMatch(/reqHeaders/);
    expect(error.message).not.toMatch(/^Authentication required$/);
  });

  it("keeps the generic message when credentials were forwarded but rejected", async () => {
    const { services } = await createTestServices();
    const handlers = createTestHandlers(services);

    await expect(
      handlers.organizations.listOrganizations({
        context: { reqHeaders: { cookie: "better-auth.session_token=bogus" } },
      }),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "Authentication required",
    });
  });

  it("authorizes when reqHeaders carry the caller's session", async () => {
    const { services } = await createTestServices();
    const user = await createTestUser(services);
    const handlers = createTestHandlers(services);

    const organizations = await handlers.organizations.listOrganizations({
      context: { reqHeaders: user.reqHeaders },
    });

    expect(Array.isArray(organizations)).toBe(true);
  });
});
