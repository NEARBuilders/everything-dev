import type { WithEffectContext } from "@orpc/experimental-effect";
import { type Implementer, ORPCError } from "@orpc/server";
import { and, asc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { type AuthContextShape, createAuthMiddleware } from "everything-dev/api";
import type { ContractType } from "../contract";
import * as schema from "../db/schema";
import { AuthServicesTag } from "../service-types";
import { tryJsonParse } from "../utils";

const attempt = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (error) =>
      error instanceof ORPCError
        ? error
        : new ORPCError("INTERNAL_SERVER_ERROR", {
            message: "Could not process the organization request",
            cause: error,
          }),
  });

function serialize(organization: typeof schema.organization.$inferSelect) {
  return {
    ...organization,
    metadata: tryJsonParse<Record<string, unknown>>(organization.metadata),
  };
}

export type OrganizationRequestContext = AuthContextShape &
  WithEffectContext<AuthServicesTag> & { reqHeaders?: Record<string, string> };

export function createOrganizationRequestHandlers(
  builder: Implementer<ContractType, OrganizationRequestContext>,
  requireAuth: ReturnType<typeof import("../middleware").createRequireAuth>,
) {
  const { requireAdmin } = createAuthMiddleware<OrganizationRequestContext>(builder);
  return {
    listOrganizationRequests: builder.listOrganizationRequests
      .use(requireAuth)
      .use(requireAdmin)
      .effect(function* () {
        const services = yield* AuthServicesTag;
        const organizations = yield* attempt(() =>
          services.db.query.organization.findMany({
            where: eq(schema.organization.status, "pending"),
            orderBy: asc(schema.organization.createdAt),
          }),
        );
        return organizations.map(serialize);
      }),
    reviewOrganization: builder.reviewOrganization
      .use(requireAuth)
      .use(requireAdmin)
      .effect(function* ({ input }) {
        const services = yield* AuthServicesTag;
        const reason = input.decision === "reject" ? input.reason.trim() : "";
        if (
          input.decision !== "approve" &&
          (input.decision !== "reject" || !reason || reason.length > 2000)
        ) {
          return yield* Effect.fail(
            new ORPCError("BAD_REQUEST", {
              message: "A rejection reason is required (up to 2000 characters)",
            }),
          );
        }
        const organization = yield* attempt(() =>
          services.db.transaction(async (tx) => {
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
              throw new ORPCError("BAD_REQUEST", {
                message: "Organization is no longer pending or does not exist",
              });
            if (input.decision === "approve") {
              if (!reviewed.requestedBy)
                throw new ORPCError("BAD_REQUEST", {
                  message: "Organization requester is missing",
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
        return serialize(organization);
      }),
  };
}
