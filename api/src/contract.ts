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

const ErrorTestKindSchema = z.enum([
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "bad_request",
  "internal",
]);

export const BundleFileSchema = z.object({
  path: z.string().min(1).max(512),
  contentBase64: z.string().min(1),
});

export const StorageUploadResultSchema = z.object({
  stored: z.number().int(),
  totalBytes: z.number().int(),
  integrity: z.record(z.string(), z.string()),
  storage: z
    .enum(["s3", "memory"])
    .describe(
      "Resolved bundle-storage backend: `s3` (R2/MinIO, persistent) or `memory` (ephemeral — bytes are lost on restart)",
    ),
});

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

  uploadStorageBundle: oc
    .route({
      method: "POST",
      path: "/storage/bundles",
      summary: "Upload workspace bundle files",
      description:
        "Receives base64-encoded dist files for one workspace namespace, SRI-hashes each server-side, and stores them in the platform bundle storage (R2 in production, memory fallback in dev).",
      tags: ["Storage"],
    })
    .input(
      z.object({
        account: z.string().min(1),
        gateway: z.string().min(1),
        workspace: z.string().min(1),
        files: z.array(BundleFileSchema).min(1).max(10_000),
      }),
    )
    .output(StorageUploadResultSchema)
    .errors({ UNAUTHORIZED, FORBIDDEN, BAD_REQUEST, CONNECTION_ERROR }),
});

export type ContractType = typeof contract;
