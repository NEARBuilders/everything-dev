import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestHandlers, createTestServices, createTestUser } from "../helpers";

describe("passkeys route", () => {
  let setup: Awaited<ReturnType<typeof createTestServices>>;

  beforeEach(async () => {
    setup = await createTestServices();
  });

  afterEach(async () => {
    await setup.driver.close();
  });

  it("rejects unauthenticated callers", async () => {
    const handlers = createTestHandlers(setup.services).passkeys;
    await expect(handlers.listUserPasskeys({ context: {} })).rejects.toThrow();
  });

  it("returns an empty list for a user without passkeys", async () => {
    const user = await createTestUser(setup.services);
    const handlers = createTestHandlers(setup.services).passkeys;
    const result = await handlers.listUserPasskeys({
      context: { reqHeaders: user.reqHeaders },
    });
    expect(result).toEqual([]);
  });
});
