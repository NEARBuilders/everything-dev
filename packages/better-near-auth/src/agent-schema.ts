import type { BetterAuthPluginDBSchema } from "better-auth/db";

export const agentSchema = {
  agentAccount: {
    fields: {
      userId: {
        type: "string",
        references: {
          model: "user",
          field: "id",
        },
        required: true,
      },
      agentId: {
        type: "string",
        required: true,
      },
      name: {
        type: "string",
        required: true,
      },
      ownerType: {
        type: "string",
        required: true,
      },
      ownerAccountId: {
        type: "string",
        required: false,
      },
      status: {
        type: "string",
        required: true,
      },
      createdAt: {
        type: "date",
        required: true,
      },
    },
  },
  ownerIntent: {
    fields: {
      correlationId: {
        type: "string",
        required: true,
      },
      idempotencyKey: {
        type: "string",
        required: true,
      },
      intentType: {
        type: "string",
        required: true,
      },
      agentId: {
        type: "string",
        required: false,
      },
      grantRowId: {
        type: "string",
        required: false,
      },
      userId: {
        type: "string",
        references: {
          model: "user",
          field: "id",
        },
        required: true,
      },
      status: {
        type: "string",
        required: true,
      },
      expiresAt: {
        type: "date",
        required: true,
      },
      createdAt: {
        type: "date",
        required: true,
      },
    },
  },
  agentGrant: {
    fields: {
      userId: {
        type: "string",
        references: {
          model: "user",
          field: "id",
        },
        required: true,
      },
      agentId: {
        type: "string",
        required: true,
      },
      grantId: {
        type: "string",
        required: false,
      },
      correlationId: {
        type: "string",
        required: false,
      },
      label: {
        type: "string",
        required: true,
      },
      tokenCiphertext: {
        type: "string",
        required: true,
      },
      tokenIv: {
        type: "string",
        required: true,
      },
      commitment: {
        type: "string",
        required: true,
      },
      expiresAt: {
        type: "date",
        required: true,
      },
      revokedAt: {
        type: "date",
        required: false,
      },
      createdAt: {
        type: "date",
        required: true,
      },
    },
  },
} satisfies BetterAuthPluginDBSchema;
