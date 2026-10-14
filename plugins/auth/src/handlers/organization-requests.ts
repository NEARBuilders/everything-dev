import type { WithEffectContext } from "@orpc/experimental-effect";
import type { Implementer } from "@orpc/server";
import { and, asc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { type AuthContextShape, createAuthMiddleware } from "everything-dev/api";
import type { ContractType } from "../contract";
import { DatabaseTag } from "../db/layer";
import * as schema from "../db/schema";
import type {
  AuthEffectServices,
  AuthHandlerAuthedContext,
  AuthHandlerContext,
  RequireAuthMiddleware,
} from "../middleware";
import { toOrganizationRecord } from "../serializers";
import { attemptDb } from "./attempts";

export type OrganizationRequestContext = AuthContextShape &
  WithEffectContext<AuthEffectServices> & { reqHeaders?: Record<string, string> };

export function createOrganizationRequestHandlers(
  builder: Implementer<ContractType, AuthHandlerContext>,
  requireAuth: RequireAuthMiddleware,
) {
  const { requireAdmin } = createAuthMiddleware<AuthHandlerAuthedContext>(builder);
  return {
    listOrganizationRequests: builder.listOrganizationRequests
      .use(requireAuth)
      .use(requireAdmin)
      .effect(function* () {
        const db = yield* DatabaseTag;
        const organizations = yield* attemptDb(() =>
          db.query.organization.findMany({
            where: eq(schema.organization.status, "pending"),
            orderBy: asc(schema.organization.createdAt),
          }),
        );
        return organizations.map(toOrganizationRecord);
      }),
    reviewOrganization: builder.reviewOrganization
      .use(requireAuth)
      .use(requireAdmin)
      .effect(function* ({ input, errors }) {
        const db = yield* DatabaseTag;
        const reason = input.decision === "reject" ? input.reason.trim() : "";
        if (
          input.decision !== "approve" &&
          (input.decision !== "reject" || !reason || reason.length > 2000)
        ) {
          return yield* Effect.fail(
            errors.BAD_REQUEST({
              message: "A rejection reason is required (up to 2000 characters)",
              data: {},
            }),
          );
        }
        const organization = yield* attemptDb(() =>
          db.transaction(async (tx) => {
            const [reviewed] = await tx
              .update(schema.organization)
              .set({
                status: input.decision === "approve" ? "active" : "rejected",
                rejectionReason: input.decision === "reject" ? reason : null,
              })
              .where(
                and(
                  eq(schema.organization.id, input.organizationId),
                  eq(schema.organization.status, "pending"),
                ),
              )
              .returning();
            if (!reviewed)
              throw errors.BAD_REQUEST({
                message: "Organization is no longer pending or does not exist",
                data: {},
              });
            if (input.decision === "approve") {
              if (!reviewed.requestedBy)
                throw errors.BAD_REQUEST({
                  message: "Organization requester is missing",
                  data: {},
                });
              const members = await tx
                .update(schema.member)
                .set({ role: "owner" })
                .where(
                  and(
                    eq(schema.member.organizationId, reviewed.id),
                    eq(schema.member.userId, reviewed.requestedBy),
                  ),
                )
                .returning();
              if (!members.length)
                await tx.insert(schema.member).values({
                  id: crypto.randomUUID(),
                  organizationId: reviewed.id,
                  userId: reviewed.requestedBy,
                  role: "owner",
                  createdAt: new Date(),
                });
            }
            return reviewed;
          }),
        );
        return toOrganizationRecord(organization);
      }),
  };
}
