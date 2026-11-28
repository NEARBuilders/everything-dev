import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestHandlers,
  createTestServices,
  createTestUser,
  TEST_PERMISSIONS,
} from "../helpers";

let setup: Awaited<ReturnType<typeof createTestServices>>;

beforeAll(async () => {
  setup = await createTestServices({
    siwn: {
      recipient: "test.near",
      permissions: { ...TEST_PERMISSIONS, areas: ["finance", "events"] },
    },
  });
}, 30000);

afterAll(async () => {
  await setup.driver.close();
}, 30000);

describe("getPermissionRegistry", () => {
  it("returns the declared statements, role grants, and team areas to a signed-in user", async () => {
    const user = await createTestUser(setup.services);
    const handlers = createTestHandlers(setup.services).permissions;

    const registry = await handlers.getPermissionRegistry({
      context: { reqHeaders: user.reqHeaders },
    });

    expect(registry.statements).toEqual(TEST_PERMISSIONS.statements);
    expect(registry.roles).toEqual(TEST_PERMISSIONS.roles);
    expect(registry.areas).toEqual(["finance", "events"]);
  });

  it("refuses an unauthenticated caller", async () => {
    const handlers = createTestHandlers(setup.services).permissions;

    await expect(handlers.getPermissionRegistry({ context: { reqHeaders: {} } })).rejects.toThrow();
  });
});
