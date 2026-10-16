import "@orpc/openapi/extensions/route";
import { oc } from "@orpc/contract";
import { z } from "zod";

/**
 * Agent Connect control-plane contract.
 *
 * Output envelopes are deliberately loose (`z.looseObject`): the hosted Agent
 * API (via `@near-intents-agent-api/sdk`) is the source of truth for every
 * domain shape — see `.agents/skills/near-intents-agent-api` and the hosted
 * `/openapi.json`. Re-declaring deep shapes here would drift.
 */

const Errors = {
  UNAUTHORIZED: {
    message: "Authentication required",
  },
  FORBIDDEN: {
    message: "Operation not permitted",
  },
  NOT_FOUND: {
    message: "Agent not found for this user",
  },
  CONFLICT: {
    message: "Conflict with the Agent API state",
  },
  BAD_REQUEST: {
    message: "Bad request",
  },
  TOO_MANY_REQUESTS: {
    message: "Agent API rate limit reached",
  },
  BAD_GATEWAY: {
    message: "Agent API returned an upstream failure",
  },
  SERVICE_UNAVAILABLE: {
    message: "Agent API is unreachable — retry with the same request",
  },
};

const PolicySchema = z
  .record(z.string(), z.unknown())
  .describe("Owner-signed spending policy — the hosted Agent API validates its shape");

const SignedDataSchema = z
  .record(z.string(), z.unknown())
  .describe("The wallet's signature output over intent.payload, submitted unchanged");

/**
 * The browser-visible intent envelope: `intent.payload` + `preview` are all a
 * browser ever sees — never the `naa_` partner key or an `ngt_` grant token.
 */
const GeneratedIntentSchema = z.looseObject({
  correlation_id: z.string().describe("Tracking id of the generated owner intent"),
  type: z.string().describe("Intent type, e.g. agent_create, grant_issue, grant_revoke"),
  status: z.string().describe("Intent status, e.g. PENDING_SIGNATURE"),
  expires_at: z.string().describe("ISO datetime after which the intent can no longer be signed"),
  intent: z.looseObject({
    standard: z.string().describe("Signing standard: nep413 | nep366 | eip712 | webauthn"),
    payload: z.record(z.string(), z.unknown()).describe("The exact bytes the owner's wallet signs"),
  }),
  preview: z
    .unknown()
    .optional()
    .describe("Human-readable summary shown to the owner before signing"),
});

const StatusSchema = z.looseObject({
  correlation_id: z.string().describe("Tracking id of the intent"),
  status: z
    .string()
    .describe("SUCCESS | FAILED | PENDING_SIGNATURE | UNCERTAIN | NEEDS_REVIEW | …"),
  type: z.string().optional().describe("Intent type"),
  details: z.unknown().optional().describe("Intent-type-specific result details"),
});

const AgentPageSchema = z.looseObject({
  data: z.array(z.unknown()).describe("Agent views"),
  next_cursor: z.string().nullable().optional().describe("Cursor for the next page"),
});

const AgentViewSchema = z.looseObject({
  id: z.string().describe("Agent account id"),
});

const GrantsSchema = z.object({
  data: z.array(z.unknown()).describe("Grant views for the agent account"),
});

const PrepareIntentInputSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("agent_create"),
    name: z.string().min(1).max(64).describe("Display name for the new agent account"),
    policy: PolicySchema,
  }),
  z.object({
    type: z.literal("grant_issue"),
    agentId: z.string().min(1).describe("Agent account to issue the grant on"),
    label: z.string().min(1).max(100).describe("Label for the grant, e.g. the session it serves"),
    expiresAt: z
      .string()
      .datetime()
      .optional()
      .describe("Grant expiry; default 7 days, max 365 days"),
  }),
  z.object({
    type: z.literal("grant_revoke"),
    agentId: z.string().min(1).describe("Agent account holding the grant"),
    grantId: z.string().min(1).describe("Grant to revoke"),
  }),
]);

export const contract = oc.router({
  agentCreate: oc
    .route({
      method: "POST",
      path: "/agents",
      summary: "Prepare agent account creation",
      description:
        "Generates the owner-signed agent_create intent. The browser signs intent.payload and submits it via intentSubmit. Requires authentication.",
      tags: ["Agents"],
    })
    .input(
      z.object({
        name: z.string().min(1).max(64).describe("Display name for the new agent account"),
        policy: PolicySchema,
      }),
    )
    .output(GeneratedIntentSchema)
    .errors({
      UNAUTHORIZED: Errors.UNAUTHORIZED,
      BAD_REQUEST: Errors.BAD_REQUEST,
      SERVICE_UNAVAILABLE: Errors.SERVICE_UNAVAILABLE,
      TOO_MANY_REQUESTS: Errors.TOO_MANY_REQUESTS,
      BAD_GATEWAY: Errors.BAD_GATEWAY,
      INTERNAL_SERVER_ERROR: { message: "Agent API call failed" },
    }),

  agentList: oc
    .route({
      method: "GET",
      path: "/agents",
      summary: "List the user's agent accounts",
      description: "Lists agent accounts registered on the hosted Agent API for this user.",
      tags: ["Agents"],
    })
    .output(AgentPageSchema)
    .errors({
      UNAUTHORIZED: Errors.UNAUTHORIZED,
      BAD_REQUEST: Errors.BAD_REQUEST,
      CONFLICT: Errors.CONFLICT,
      TOO_MANY_REQUESTS: Errors.TOO_MANY_REQUESTS,
      SERVICE_UNAVAILABLE: Errors.SERVICE_UNAVAILABLE,
      BAD_GATEWAY: Errors.BAD_GATEWAY,
      INTERNAL_SERVER_ERROR: { message: "Agent API call failed" },
    }),

  agentGet: oc
    .route({
      method: "GET",
      path: "/agents/{agentId}",
      summary: "Get an agent account view",
      description: "Fetches one agent account; refused unless the agent belongs to the caller.",
      tags: ["Agents"],
    })
    .input(
      z.object({
        agentId: z.string().min(1).describe("Agent account id"),
      }),
    )
    .output(AgentViewSchema)
    .errors({
      UNAUTHORIZED: Errors.UNAUTHORIZED,
      BAD_REQUEST: Errors.BAD_REQUEST,
      CONFLICT: Errors.CONFLICT,
      TOO_MANY_REQUESTS: Errors.TOO_MANY_REQUESTS,
      NOT_FOUND: Errors.NOT_FOUND,
      SERVICE_UNAVAILABLE: Errors.SERVICE_UNAVAILABLE,
      BAD_GATEWAY: Errors.BAD_GATEWAY,
      INTERNAL_SERVER_ERROR: { message: "Agent API call failed" },
    }),

  prepareIntent: oc
    .route({
      method: "POST",
      path: "/agents/intents/prepare",
      summary: "Prepare an owner intent for signing",
      description:
        "Generates a grant_issue or grant_revoke owner intent for the caller to sign. Grant tokens are created server-side, sealed at rest, and never appear in the response — only their commitment enters the intent.",
      tags: ["Intents"],
    })
    .input(PrepareIntentInputSchema)
    .output(GeneratedIntentSchema)
    .errors({
      UNAUTHORIZED: Errors.UNAUTHORIZED,
      NOT_FOUND: Errors.NOT_FOUND,
      BAD_REQUEST: Errors.BAD_REQUEST,
      SERVICE_UNAVAILABLE: Errors.SERVICE_UNAVAILABLE,
      TOO_MANY_REQUESTS: Errors.TOO_MANY_REQUESTS,
      BAD_GATEWAY: Errors.BAD_GATEWAY,
      INTERNAL_SERVER_ERROR: { message: "Agent API call failed" },
    }),

  intentSubmit: oc
    .route({
      method: "POST",
      path: "/agents/intents/submit",
      summary: "Submit a signed owner intent",
      description:
        "Submits the wallet's signature output for a previously prepared intent. The correlation id must have been issued to the calling user, and the intent type must match.",
      tags: ["Intents"],
    })
    .input(
      z.object({
        type: z
          .enum(["agent_create", "grant_issue", "grant_revoke"])
          .describe("Must match the type of the issued intent"),
        correlationId: z.string().min(1).describe("The correlation id returned at prepare time"),
        signedData: SignedDataSchema,
      }),
    )
    .output(StatusSchema)
    .errors({
      UNAUTHORIZED: Errors.UNAUTHORIZED,
      NOT_FOUND: Errors.NOT_FOUND,
      BAD_REQUEST: Errors.BAD_REQUEST,
      SERVICE_UNAVAILABLE: Errors.SERVICE_UNAVAILABLE,
      TOO_MANY_REQUESTS: Errors.TOO_MANY_REQUESTS,
      BAD_GATEWAY: Errors.BAD_GATEWAY,
      INTERNAL_SERVER_ERROR: { message: "Agent API call failed" },
    }),

  intentStatus: oc
    .route({
      method: "POST",
      path: "/agents/intents/status",
      summary: "Read the status of an issued intent",
      description:
        "Polls the hosted Agent API for an intent's status; the correlation id must have been issued to the calling user.",
      tags: ["Intents"],
    })
    .input(
      z.object({
        correlationId: z.string().min(1).describe("The correlation id returned at prepare time"),
        waitMs: z
          .number()
          .int()
          .min(0)
          .max(30_000)
          .optional()
          .describe("Long-poll up to this many milliseconds for a terminal status"),
      }),
    )
    .output(StatusSchema)
    .errors({
      UNAUTHORIZED: Errors.UNAUTHORIZED,
      NOT_FOUND: Errors.NOT_FOUND,
      SERVICE_UNAVAILABLE: Errors.SERVICE_UNAVAILABLE,
      TOO_MANY_REQUESTS: Errors.TOO_MANY_REQUESTS,
      BAD_GATEWAY: Errors.BAD_GATEWAY,
      INTERNAL_SERVER_ERROR: { message: "Agent API call failed" },
    }),

  grantList: oc
    .route({
      method: "GET",
      path: "/agents/{agentId}/grants",
      summary: "List an agent account's grants",
      description:
        "Lists grants from the hosted Agent API; refused unless the agent belongs to the caller.",
      tags: ["Grants"],
    })
    .input(
      z.object({
        agentId: z.string().min(1).describe("Agent account id"),
      }),
    )
    .output(GrantsSchema)
    .errors({
      UNAUTHORIZED: Errors.UNAUTHORIZED,
      BAD_REQUEST: Errors.BAD_REQUEST,
      CONFLICT: Errors.CONFLICT,
      TOO_MANY_REQUESTS: Errors.TOO_MANY_REQUESTS,
      NOT_FOUND: Errors.NOT_FOUND,
      SERVICE_UNAVAILABLE: Errors.SERVICE_UNAVAILABLE,
      BAD_GATEWAY: Errors.BAD_GATEWAY,
      INTERNAL_SERVER_ERROR: { message: "Agent API call failed" },
    }),
});

export type ContractType = typeof contract;
