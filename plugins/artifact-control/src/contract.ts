import "@orpc/openapi/extensions/route";
import { oc } from "@orpc/contract";
import {
  BAD_REQUEST,
  CONNECTION_ERROR,
  FORBIDDEN,
  UNAUTHORIZED,
} from "every-plugin/errors";
import {
  ArtifactControlBundleFileSchema,
  ArtifactControlTransferRequestSchema,
  ArtifactControlTransferResponseSchema,
} from "./client";
import { z } from "zod";

export const ArtifactControlUploadSchema = ArtifactControlTransferRequestSchema.extend({
  files: z.array(ArtifactControlBundleFileSchema).min(1).max(10_000),
});

export const contract = oc.router({
  uploadStorageBundle: oc
    .route({
      method: "POST",
      path: "/storage/bundles",
      summary: "Upload workspace bundle files",
      description:
        "Receives base64-encoded dist files for one workspace namespace, SRI-hashes each server-side, and stores them in the platform bundle storage.",
      tags: ["Storage"],
    })
    .input(ArtifactControlUploadSchema)
    .output(ArtifactControlTransferResponseSchema)
    .errors({ UNAUTHORIZED, FORBIDDEN, BAD_REQUEST, CONNECTION_ERROR }),
});

export type ContractType = typeof contract;
