import "@orpc/openapi/extensions/route";
import { oc } from "@orpc/contract";
import { BAD_REQUEST, CONNECTION_ERROR, FORBIDDEN, UNAUTHORIZED } from "every-plugin/errors";
import {
  IntegrityReportQuerySchema,
  IntegrityReportResultSchema,
  ListBundlesQuerySchema,
  ListBundlesResultSchema,
  ListVersionsQuerySchema,
  ListVersionsResultSchema,
  UploadRequestSchema,
  UploadResponseSchema,
} from "./client";

export const UploadBundleSchema = UploadRequestSchema;

export const contract = oc.router({
  uploadStorageBundle: oc
    .route({
      method: "POST",
      path: "/storage/bundles",
      summary: "Upload workspace bundle files",
      description:
        "Receives base64-encoded dist files for one workspace namespace, SRI-hashes each server-side, and stores them in the platform bundle storage. Files whose SRI matches the stored object's metadata are skipped as confirmed no-ops.",
      tags: ["Storage"],
    })
    .input(UploadBundleSchema)
    .output(UploadResponseSchema)
    .errors({ UNAUTHORIZED, FORBIDDEN, BAD_REQUEST, CONNECTION_ERROR }),

  listBundles: oc
    .route({
      method: "GET",
      path: "/storage/bundles",
      summary: "List bundle objects",
      description:
        "Lists the objects stored under an account/gateway (optionally narrowed to one workspace), flat under the namespace prefix. Requires the `bundles:read` permission scoped to the namespace.",
      tags: ["Storage"],
    })
    .input(ListBundlesQuerySchema)
    .output(ListBundlesResultSchema)
    .errors({ UNAUTHORIZED, FORBIDDEN, BAD_REQUEST, CONNECTION_ERROR }),

  listVersions: oc
    .route({
      method: "GET",
      path: "/storage/versions",
      summary: "List workspace version manifests",
      description:
        "Enumerates the immutable version manifests stored at `versions/<id>.json` for a workspace and returns each manifest's deploy coordinates (entry, gitSha, file count), newest first. Requires the `bundles:read` permission scoped to the namespace.",
      tags: ["Storage"],
    })
    .input(ListVersionsQuerySchema)
    .output(ListVersionsResultSchema)
    .errors({ UNAUTHORIZED, FORBIDDEN, BAD_REQUEST, CONNECTION_ERROR }),

  integrityReport: oc
    .route({
      method: "GET",
      path: "/storage/integrity",
      summary: "Integrity report for a version",
      description:
        "Returns the workspace's full version manifest for a version id and re-verifies the entry object's bytes against the manifest's `entryIntegrity`. Requires the `bundles:read` permission scoped to the namespace.",
      tags: ["Storage"],
    })
    .input(IntegrityReportQuerySchema)
    .output(IntegrityReportResultSchema)
    .errors({ UNAUTHORIZED, FORBIDDEN, BAD_REQUEST, CONNECTION_ERROR }),
});

export type ContractType = typeof contract;
