import { Effect, Layer } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseTag } from "../../src/db/layer";
import * as schema from "../../src/db/schema";
import { AuthApiTag, PermissionRegistryTag } from "../../src/service-types";
import { buildPermissionsService, PermissionsService } from "../../src/services/permissions";
import {
  addTestMember,
  createTestOrg,
  createTestServices,
  createTestUser,
  TEST_PERMISSIONS,
} from "../helpers";

let services: Awaited<ReturnType<typeof createTestServices>>;

beforeAll(async () => {
  services = await createTestServices();
}, 30000);

afterAll(async () => {
  await services.driver.close();
}, 30000);

function permissionsLayer() {
  return Layer.effect(
    PermissionsService,
    Effect.gen(function* () {
      const auth = (yield* AuthApiTag).auth;
      const db = yield* DatabaseTag;
      const registry = yield* PermissionRegistryTag;
      return buildPermissionsService({ auth, db, registry });
    }),
  ).pipe(Layer.provide(tagsLayer()));
}

function tagsLayer() {
  return Layer.mergeAll(
    Layer.succeed(AuthApiTag, {
      auth: services.services.auth,
      handler: services.services.handler,
      apiKeyHeaders: services.services.apiKeyHeaders,
    }),
    Layer.succeed(DatabaseTag, services.services.db),
    Layer.succeed(PermissionRegistryTag, {
      statements: TEST_PERMISSIONS.statements,
      roleGrants: TEST_PERMISSIONS.roles,
    }),
  );
}

function runHasTeamPermission(
  userId: string,
  organizationId: string,
  required: Record<string, string[]>,
) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* PermissionsService;
      return yield* permissions.hasTeamPermission({ userId }, organizationId, required);
    }).pipe(Effect.provide(permissionsLayer())),
  );
}

describe("PermissionsService.hasTeamPermission", () => {
  it("unions org-role and team-role grants", async () => {
    const owner = await createTestUser(services.services);
    const member = await createTestUser(services.services, {
      email: `hp-${crypto.randomUUID()}@example.com`,
    });
    const org = await createTestOrg(services.services, owner.userId);
    await addTestMember(services.services, org.id, member.userId, "member");
    const team = await services.services.db
      .insert(schema.team)
      .values({
        id: crypto.randomUUID(),
        name: "Union Crew",
        organizationId: org.id,
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()
      .then((rows) => rows[0]!);
    await services.services.db.insert(schema.teamMember).values({
      id: crypto.randomUUID(),
      teamId: team.id,
      userId: member.userId,
      role: "owner",
      createdAt: new Date(),
    });

    const permitted = await runHasTeamPermission(member.userId, org.id, { team: ["update"] });
    expect(permitted).toBe(true);
  });

  it("denies when neither the org role nor any team role grants the action", async () => {
    const owner = await createTestUser(services.services);
    const member = await createTestUser(services.services, {
      email: `hp-${crypto.randomUUID()}@example.com`,
    });
    const org = await createTestOrg(services.services, owner.userId);
    await addTestMember(services.services, org.id, member.userId, "member");

    const permitted = await runHasTeamPermission(member.userId, org.id, { team: ["update"] });
    expect(permitted).toBe(false);
  });
});
