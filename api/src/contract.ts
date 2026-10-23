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
  }),
});

export type ContractType = typeof contract;
