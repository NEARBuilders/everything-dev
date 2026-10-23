import "@orpc/openapi/extensions/route";
import { oc } from "@orpc/contract";
import {
  BAD_REQUEST,
  CONNECTION_ERROR,
  FORBIDDEN,
  NOT_FOUND,
  UNAUTHORIZED,
} from "every-plugin/errors";
import { z } from "zod";
import { ListDeploysInputSchema, ListDeploysOutputSchema } from "./lib/deploy-history";
import { ReconcilerStatusSchema } from "./lib/reconciler-schema";

const ErrorTestKindSchema = z.enum([
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "bad_request",
  "internal",
]);

export const contract = oc.router({
  ping: oc.route({ method: "GET", path: "/ping" }).output(
    z.object({
      status: z.literal("ok"),
      timestamp: z.iso.datetime(),
    }),
  ),

  testError: oc
    .route({
      method: "GET",
      path: "/errors",
      summary: "Trigger a specific error kind",
      description:
        "Regression-test helper that throws the requested error kind so the host error surface can be validated.",
      tags: ["Testing"],
    })
    .input(
      z.object({
        kind: ErrorTestKindSchema.describe("Which error kind to trigger"),
      }),
    )
    .output(
      z.object({
        ok: z.literal(true).describe("Always true when no error is thrown"),
      }),
    )
    .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST, CONNECTION_ERROR }),

  hosting: oc.router({
    listDeploys: oc
      .route({
        method: "GET",
        path: "/hosting/deploys",
        summary: "List deploy history",
        description:
          "One row per published deploy, resolved from the namespace's per-deploy audit manifests on the FastKV registry (public reads, any account/gateway namespace).",
        tags: ["Hosting"],
      })
      .input(ListDeploysInputSchema)
      .output(ListDeploysOutputSchema)
      .errors({ UNAUTHORIZED, CONNECTION_ERROR }),

    reconcilerStatus: oc
      .route({
        method: "POST",
        path: "/hosting/reconciler/status",
        summary: "Reconciler status",
        description:
          "Per-namespace reconciliation state for the platform-side watcher: last-seen and converged fingerprints, boot assumptions, drift reasons, and instance URLs. Disabled (empty watch list) reports no namespaces.",
        tags: ["Hosting"],
      })
      .input(z.object({}))
      .output(ReconcilerStatusSchema)
      .errors({ UNAUTHORIZED }),

    rollback: oc
      .route({
        method: "POST",
        path: "/hosting/rollback",
        summary: "Roll back to a previous deploy snapshot",
        description:
          "Republishes the config snapshot at the given block height with the CLI's verification semantics (pinned-slot SRI checks, refuse rather than half-execute), stamping rolledBackFrom; the config and the audit manifest ride one atomic write signed by this runtime's own key. Own namespace only — other namespaces roll back from their own runtime's console.",
        tags: ["Hosting"],
      })
      .input(
        z.object({
          account: z.string().min(1).describe("Runtime account (must be this runtime's own)"),
          gateway: z.string().min(1).describe("Runtime gateway (must be this runtime's own)"),
          blockHeight: z.number().int().min(1).describe("Block height of the target deploy row"),
        }),
      )
      .output(
        z.object({
          status: z.enum(["published", "refused"]),
          txHash: z.string().optional(),
          blockHeight: z.number().int().optional(),
          reason: z.string().optional(),
          verification: z
            .array(
              z.object({
                slot: z.string(),
                ok: z.boolean(),
                reason: z.string().optional(),
              }),
            )
            .optional(),
        }),
      )
      .errors({ UNAUTHORIZED }),
  }),

  secrets: oc.router({
    set: oc
      .route({
        method: "POST",
        path: "/secrets/set",
        summary: "Store a runtime secret",
        description:
          "Seals the value with the runtime's KEK (derived from the platform root secret) and stores it keyed by (account, gateway, name). Values are never echoed back after set.",
        tags: ["Secrets"],
      })
      .input(
        z.object({
          account: z.string().min(1).describe("Runtime account (NEAR account id)"),
          gateway: z.string().min(1).describe("Runtime gateway id (its public domain)"),
          name: z
            .string()
            .regex(/^[A-Z][A-Z0-9_]*$/)
            .describe("Secret name, UPPER_SNAKE_CASE — BOS_* and PORT are reserved"),
          value: z.string().min(1).describe("The secret value (plaintext in transit over TLS)"),
        }),
      )
      .output(
        z.object({
          name: z.string(),
        }),
      )
      .errors({ UNAUTHORIZED, BAD_REQUEST, CONNECTION_ERROR }),

    list: oc
      .route({
        method: "POST",
        path: "/secrets/list",
        summary: "List runtime secret status",
        description:
          "Names + set/missing/undeclared status only — never values. `declared` reconciles the stored rows against the runtime's declared secrets.",
        tags: ["Secrets"],
      })
      .input(
        z.object({
          account: z.string().min(1),
          gateway: z.string().min(1),
          declared: z.array(z.string()).optional(),
        }),
      )
      .output(
        z.object({
          secrets: z.array(
            z.object({
              name: z.string(),
              state: z.enum(["set", "missing", "undeclared"]),
            }),
          ),
          missing: z.array(z.string()),
        }),
      )
      .errors({ UNAUTHORIZED, CONNECTION_ERROR }),

    remove: oc
      .route({
        method: "POST",
        path: "/secrets/remove",
        summary: "Remove a runtime secret",
        tags: ["Secrets"],
      })
      .input(
        z.object({
          account: z.string().min(1),
          gateway: z.string().min(1),
          name: z.string().min(1),
        }),
      )
      .output(z.object({ removed: z.boolean() }))
      .errors({ UNAUTHORIZED, CONNECTION_ERROR }),
  }),
});

export type ContractType = typeof contract;
