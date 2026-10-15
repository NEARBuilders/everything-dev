import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import type { BetterAuthPlugin, DBAdapter } from "better-auth/types";
import z from "zod";
import type {
  AgentApiOptions,
  GenerateIntentResponse,
  IdempotentResult,
  OwnerWallet,
  Policy,
  SignedData,
  StatusResponse,
} from "./agent-api.js";
import {
  AgentApiError,
  AgentApiRequestError,
  createAgentApiClient,
  createGrantCredential,
  createIdempotencyKey,
} from "./agent-api.js";
import { agentSchema } from "./agent-schema.js";
import type { NearAccount } from "./types.js";
import { decryptPrivateKey, encryptPrivateKey } from "./utils.js";

const GRANT_TOKEN_SALT = "better-near-auth-agents";
const MAX_GRANT_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const DEFAULT_GRANT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const INTENT_TYPES = [
  "agent_create",
  "policy_update",
  "agent_freeze",
  "agent_unfreeze",
  "grant_issue",
  "grant_revoke",
  "execution_cancel",
  "agent_archive",
  "agent_restore",
  "agent_delete",
  "approval_vote",
] as const;

const intentTypeSchema = z.enum(INTENT_TYPES);

export const CreateAgentRequest = z.object({
  name: z.string().min(1).max(64),
  policy: z.custom<Policy>(() => true),
});
export type CreateAgentRequestT = z.infer<typeof CreateAgentRequest>;

export const SubmitAgentIntentRequest = z.object({
  type: intentTypeSchema,
  correlationId: z.string().min(1),
  signedData: z.custom<SignedData>(() => true),
});
export type SubmitAgentIntentRequestT = z.infer<typeof SubmitAgentIntentRequest>;

export const AgentStatusRequest = z.object({
  correlationId: z.string().min(1),
  waitMs: z.number().int().min(0).max(30_000).optional(),
});
export type AgentStatusRequestT = z.infer<typeof AgentStatusRequest>;

export const IssueAgentGrantRequest = z.object({
  agentId: z.string().min(1),
  label: z.string().min(1).max(100),
  expiresAt: z.string().datetime().optional(),
});
export type IssueAgentGrantRequestT = z.infer<typeof IssueAgentGrantRequest>;

export const RevokeAgentGrantRequest = z.object({
  agentId: z.string().min(1),
  grantId: z.string().min(1),
});
export type RevokeAgentGrantRequestT = z.infer<typeof RevokeAgentGrantRequest>;

export const ListAgentGrantsRequest = z.object({
  agentId: z.string().min(1),
});
export type ListAgentGrantsRequestT = z.infer<typeof ListAgentGrantsRequest>;

export interface AgentAccountRow {
  id: string;
  userId: string;
  agentId: string;
  name: string;
  ownerType: string;
  ownerAccountId?: string | null;
  status: string;
  createdAt: Date;
}

export interface OwnerIntentRow {
  id: string;
  correlationId: string;
  idempotencyKey: string;
  intentType: string;
  agentId?: string | null;
  grantId?: string | null;
  userId: string;
  status: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface AgentGrantRow {
  id: string;
  userId: string;
  agentId: string;
  grantId?: string | null;
  correlationId?: string | null;
  label: string;
  tokenCiphertext: string;
  tokenIv: string;
  commitment: string;
  expiresAt: Date;
  revokedAt?: Date | null;
  createdAt: Date;
}

export interface AgentConnectPasskeyOwner {
  rpId: string;
  origin: string;
}

export type AgentConnectOptions = Omit<AgentApiOptions, "apiKey" | "grantToken"> & {
  apiKey?: string;
  passkeyOwner?: AgentConnectPasskeyOwner;
};

const AGENT_API_ERROR_STATUS: Record<number, string> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  410: "NOT_FOUND",
  429: "TOO_MANY_REQUESTS",
  502: "BAD_GATEWAY",
  503: "SERVICE_UNAVAILABLE",
};

function mapAgentApiError(error: unknown): never {
  if (error instanceof AgentApiRequestError) {
    throw new APIError("SERVICE_UNAVAILABLE", {
      message: "Agent API is unreachable — retry with the same request",
      status: 503,
    });
  }
  if (error instanceof AgentApiError) {
    const betterAuthStatus = (AGENT_API_ERROR_STATUS[error.status] ??
      "INTERNAL_SERVER_ERROR") as "BAD_REQUEST";
    throw new APIError(betterAuthStatus, {
      message: error.detail || error.title,
      code: error.code,
      retryable: error.retryable,
      availableAt: error.availableAt,
      status: error.status,
    });
  }
  throw error;
}

async function encryptGrantToken(
  token: string,
  secret: string,
): Promise<{ encrypted: string; iv: string }> {
  return encryptPrivateKey(new TextEncoder().encode(token), secret, GRANT_TOKEN_SALT);
}

async function decryptGrantToken(encrypted: string, iv: string, secret: string): Promise<string> {
  const bytes = await decryptPrivateKey(encrypted, iv, secret, GRANT_TOKEN_SALT);
  return new TextDecoder().decode(bytes);
}

export const agentConnect = (options: AgentConnectOptions): BetterAuthPlugin => {
  if (!options.apiKey) {
    return {
      id: "agentConnect",
      schema: agentSchema,
      endpoints: {},
    };
  }

  const api = createAgentApiClient({
    baseUrl: options.baseUrl,
    timeoutMs: options.timeoutMs,
    maxResponseBytes: options.maxResponseBytes,
    fetch: options.fetch,
    apiKey: options.apiKey,
  });

  const requireUser = (session: { user: { id: string } } | null): string => {
    if (!session) {
      throw new APIError("UNAUTHORIZED", { message: "Authentication required", status: 401 });
    }
    return session.user.id;
  };

  const requireOwnedAgent = async (
    adapter: DBAdapter,
    userId: string,
    agentId: string,
  ): Promise<AgentAccountRow> => {
    const row = (await adapter.findOne({
      model: "agentAccount",
      where: [
        { field: "agentId", operator: "eq", value: agentId },
        { field: "userId", operator: "eq", value: userId },
      ],
    })) as AgentAccountRow | null;
    if (!row) {
      throw new APIError("NOT_FOUND", {
        message: "Agent not found for this user",
        status: 404,
      });
    }
    return row;
  };

  const requireOwnedIntent = async (
    adapter: DBAdapter,
    userId: string,
    correlationId: string,
  ): Promise<OwnerIntentRow> => {
    const row = (await adapter.findOne({
      model: "ownerIntent",
      where: [{ field: "correlationId", operator: "eq", value: correlationId }],
    })) as OwnerIntentRow | null;
    if (!row) {
      throw new APIError("NOT_FOUND", { message: "Unknown correlation id", status: 404 });
    }
    if (row.userId !== userId) {
      throw new APIError("FORBIDDEN", {
        message: "This intent does not belong to the current session",
        status: 403,
      });
    }
    return row;
  };

  const deriveOwner = async (adapter: DBAdapter, userId: string): Promise<OwnerWallet> => {
    const nearAccount = (await adapter.findOne({
      model: "nearAccount",
      where: [
        { field: "userId", operator: "eq", value: userId },
        { field: "isPrimary", operator: "eq", value: true },
      ],
    })) as NearAccount | null;
    if (nearAccount) {
      return {
        type: "near",
        account_id: nearAccount.accountId,
        public_key: nearAccount.publicKey,
      };
    }
    if (options.passkeyOwner) {
      const authenticators = (await adapter.findMany({
        model: "passkey",
        where: [{ field: "userId", operator: "eq", value: userId }],
      })) as Array<{ credentialID: string; publicKey: string; createdAt?: Date | string }> | null;
      const latest = authenticators
        ?.slice()
        .sort(
          (a, b) =>
            (a.createdAt ? new Date(a.createdAt).getTime() : 0) -
            (b.createdAt ? new Date(b.createdAt).getTime() : 0),
        )
        .at(-1);
      if (latest) {
        return {
          type: "passkey",
          credential_id: latest.credentialID,
          public_key: latest.publicKey,
          rp_id: options.passkeyOwner.rpId,
          origin: options.passkeyOwner.origin,
        };
      }
    }
    throw new APIError("BAD_REQUEST", {
      message: "No owner wallet available — link a NEAR account or register a passkey first",
      status: 400,
    });
  };

  const recordIntent = async (
    adapter: DBAdapter,
    args: {
      correlationId: string;
      idempotencyKey: string;
      intentType: string;
      agentId?: string | null;
      grantId?: string | null;
      userId: string;
      status: string;
      expiresAt: string;
    },
  ): Promise<void> => {
    await adapter.create({
      model: "ownerIntent",
      data: {
        correlationId: args.correlationId,
        idempotencyKey: args.idempotencyKey,
        intentType: args.intentType,
        agentId: args.agentId ?? null,
        grantId: args.grantId ?? null,
        userId: args.userId,
        status: args.status,
        expiresAt: new Date(args.expiresAt),
        createdAt: new Date(),
      },
    });
  };

  const updateIntentStatus = async (
    adapter: DBAdapter,
    correlationId: string,
    status: string,
  ): Promise<void> => {
    try {
      await adapter.update({
        model: "ownerIntent",
        where: [{ field: "correlationId", operator: "eq", value: correlationId }],
        update: { status },
      });
    } catch (error) {
      console.error("[agentConnect] failed to update owner intent status:", error);
    }
  };

  return {
    id: "agentConnect",
    schema: agentSchema,
    endpoints: {
      createAgent: createAuthEndpoint(
        "/agent/create",
        {
          method: "POST",
          body: CreateAgentRequest,
          use: [sessionMiddleware],
        },
        async (ctx) => {
          const session = ctx.context.session;
          const userId = requireUser(session);
          const { name, policy } = ctx.body;

          const owner = await deriveOwner(ctx.context.adapter, userId);
          const idempotencyKey = createIdempotencyKey();

          let generated: IdempotentResult<GenerateIntentResponse>;
          try {
            generated = await api.generateIntent(
              {
                type: "agent_create",
                name,
                external_user_id: userId,
                owner,
                policy,
              },
              { idempotencyKey },
            );
          } catch (error) {
            mapAgentApiError(error);
          }

          try {
            await ctx.context.adapter.create({
              model: "agentAccount",
              data: {
                userId,
                agentId: generated.agent_id,
                name,
                ownerType: owner.type,
                ownerAccountId: owner.type === "near" ? owner.account_id : null,
                status: "PENDING",
                createdAt: new Date(),
              },
            });
            await recordIntent(ctx.context.adapter, {
              correlationId: generated.correlation_id,
              idempotencyKey: generated.idempotencyKey,
              intentType: "agent_create",
              agentId: generated.agent_id,
              userId,
              status: generated.status,
              expiresAt: generated.expires_at,
            });
          } catch (error) {
            console.error("[agentConnect] failed to persist agent_create state:", error);
          }

          return ctx.json(generated);
        },
      ),

      submitAgentIntent: createAuthEndpoint(
        "/agent/intents/submit",
        {
          method: "POST",
          body: SubmitAgentIntentRequest,
          use: [sessionMiddleware],
        },
        async (ctx) => {
          const session = ctx.context.session;
          const userId = requireUser(session);
          const { type, correlationId, signedData } = ctx.body;

          const intentRow = await requireOwnedIntent(ctx.context.adapter, userId, correlationId);
          if (intentRow.intentType !== type) {
            throw new APIError("BAD_REQUEST", {
              message: "Intent type does not match the issued correlation id",
              status: 400,
            });
          }

          let status: StatusResponse;
          try {
            status = await api.submitIntent({
              type,
              correlation_id: correlationId,
              signed_data: signedData,
            });
          } catch (error) {
            mapAgentApiError(error);
          }

          await updateIntentStatus(ctx.context.adapter, correlationId, status.status);

          if (type === "grant_issue" && status.status === "SUCCESS" && intentRow.grantId) {
            const details = status.details as { grant?: { grant_id: string } | null } | undefined;
            const issuedGrantId = details?.grant?.grant_id;
            if (issuedGrantId) {
              try {
                await ctx.context.adapter.update({
                  model: "agentGrant",
                  where: [{ field: "id", operator: "eq", value: intentRow.grantId }],
                  update: { grantId: issuedGrantId },
                });
              } catch (error) {
                console.error("[agentConnect] failed to link grant row:", error);
              }
            }
          }

          if (type === "grant_revoke" && status.status === "SUCCESS" && intentRow.grantId) {
            try {
              await ctx.context.adapter.update({
                model: "agentGrant",
                where: [
                  { field: "agentId", operator: "eq", value: intentRow.agentId ?? "" },
                  { field: "grantId", operator: "eq", value: intentRow.grantId },
                  { field: "userId", operator: "eq", value: userId },
                ],
                update: { revokedAt: new Date() },
              });
            } catch (error) {
              console.error("[agentConnect] failed to mark grant revoked:", error);
            }
          }

          if (type === "agent_create" && status.status === "SUCCESS" && intentRow.agentId) {
            try {
              await ctx.context.adapter.update({
                model: "agentAccount",
                where: [
                  { field: "agentId", operator: "eq", value: intentRow.agentId },
                  { field: "userId", operator: "eq", value: userId },
                ],
                update: { status: "ACTIVE" },
              });
            } catch (error) {
              console.error("[agentConnect] failed to activate agent row:", error);
            }
          }

          return ctx.json(status);
        },
      ),

      getAgentStatus: createAuthEndpoint(
        "/agent/status",
        {
          method: "POST",
          body: AgentStatusRequest,
          use: [sessionMiddleware],
        },
        async (ctx) => {
          const session = ctx.context.session;
          const userId = requireUser(session);
          const { correlationId, waitMs } = ctx.body;

          await requireOwnedIntent(ctx.context.adapter, userId, correlationId);

          let status: StatusResponse;
          try {
            status = await api.getStatus(correlationId, { waitMs });
          } catch (error) {
            mapAgentApiError(error);
          }

          await updateIntentStatus(ctx.context.adapter, correlationId, status.status);

          return ctx.json(status);
        },
      ),

      listAgents: createAuthEndpoint(
        "/agent/list",
        {
          method: "GET",
          use: [sessionMiddleware],
        },
        async (ctx) => {
          const session = ctx.context.session;
          const userId = requireUser(session);

          try {
            const page = await api.listAgents({ external_user_id: userId });
            return ctx.json({
              data: page.data,
              nextCursor: page.next_cursor,
            });
          } catch (error) {
            mapAgentApiError(error);
          }
        },
      ),

      issueAgentGrant: createAuthEndpoint(
        "/agent/grants/issue",
        {
          method: "POST",
          body: IssueAgentGrantRequest,
          use: [sessionMiddleware],
        },
        async (ctx) => {
          const session = ctx.context.session;
          const userId = requireUser(session);
          const { agentId, label, expiresAt } = ctx.body;

          await requireOwnedAgent(ctx.context.adapter, userId, agentId);

          const requestedExpiry = expiresAt ? new Date(expiresAt).getTime() : Number.NaN;
          if (expiresAt && Number.isNaN(requestedExpiry)) {
            throw new APIError("BAD_REQUEST", {
              message: "expiresAt must be an ISO datetime",
              status: 400,
            });
          }
          const maxExpiry = Date.now() + MAX_GRANT_TTL_MS;
          const resolvedExpiryMs = Number.isNaN(requestedExpiry)
            ? Date.now() + DEFAULT_GRANT_TTL_MS
            : Math.min(requestedExpiry, maxExpiry);

          const { token, commitment } = createGrantCredential();
          const encrypted = await encryptGrantToken(token, ctx.context.secret);

          const grantRow = (await ctx.context.adapter.create({
            model: "agentGrant",
            data: {
              userId,
              agentId,
              grantId: null,
              correlationId: null,
              label,
              tokenCiphertext: encrypted.encrypted,
              tokenIv: encrypted.iv,
              commitment,
              expiresAt: new Date(resolvedExpiryMs),
              revokedAt: null,
              createdAt: new Date(),
            },
          })) as AgentGrantRow | null;

          const idempotencyKey = createIdempotencyKey();
          let generated: IdempotentResult<GenerateIntentResponse>;
          try {
            generated = await api.generateIntent(
              {
                type: "grant_issue",
                agent_id: agentId,
                label,
                credential: commitment,
                expires_at: new Date(resolvedExpiryMs).toISOString(),
              },
              { idempotencyKey },
            );
          } catch (error) {
            mapAgentApiError(error);
          }

          try {
            await recordIntent(ctx.context.adapter, {
              correlationId: generated.correlation_id,
              idempotencyKey: generated.idempotencyKey,
              intentType: "grant_issue",
              agentId,
              grantId: grantRow?.id ?? null,
              userId,
              status: generated.status,
              expiresAt: generated.expires_at,
            });
          } catch (error) {
            console.error("[agentConnect] failed to persist grant_issue state:", error);
          }

          return ctx.json(generated);
        },
      ),

      revokeAgentGrant: createAuthEndpoint(
        "/agent/grants/revoke",
        {
          method: "POST",
          body: RevokeAgentGrantRequest,
          use: [sessionMiddleware],
        },
        async (ctx) => {
          const session = ctx.context.session;
          const userId = requireUser(session);
          const { agentId, grantId } = ctx.body;

          await requireOwnedAgent(ctx.context.adapter, userId, agentId);

          const idempotencyKey = createIdempotencyKey();
          let generated: IdempotentResult<GenerateIntentResponse>;
          try {
            generated = await api.generateIntent(
              {
                type: "grant_revoke",
                agent_id: agentId,
                grant_id: grantId,
              },
              { idempotencyKey },
            );
          } catch (error) {
            mapAgentApiError(error);
          }

          try {
            await recordIntent(ctx.context.adapter, {
              correlationId: generated.correlation_id,
              idempotencyKey: generated.idempotencyKey,
              intentType: "grant_revoke",
              agentId,
              grantId,
              userId,
              status: generated.status,
              expiresAt: generated.expires_at,
            });
          } catch (error) {
            console.error("[agentConnect] failed to persist grant_revoke state:", error);
          }

          return ctx.json(generated);
        },
      ),

      listAgentGrants: createAuthEndpoint(
        "/agent/grants",
        {
          method: "POST",
          body: ListAgentGrantsRequest,
          use: [sessionMiddleware],
        },
        async (ctx) => {
          const session = ctx.context.session;
          const userId = requireUser(session);
          const { agentId } = ctx.body;

          await requireOwnedAgent(ctx.context.adapter, userId, agentId);

          try {
            const grants = await api.listGrants(agentId);
            return ctx.json({ data: grants });
          } catch (error) {
            mapAgentApiError(error);
          }
        },
      ),
    },
  } satisfies BetterAuthPlugin;
};

export { agentSchema, decryptGrantToken, encryptGrantToken };
