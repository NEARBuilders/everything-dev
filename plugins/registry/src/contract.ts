import "@orpc/openapi/extensions/route";
import { oc } from "@orpc/contract";
import { Schema } from "effect";
import { BAD_REQUEST, FORBIDDEN, NOT_FOUND, UNAUTHORIZED } from "every-plugin/errors";

const orpcSchema = <S extends Schema.ConstraintDecoder<unknown>>(schema: S) =>
  Schema.toStandardJSONSchemaV1(Schema.toStandardSchemaV1(schema));

const urlString = Schema.String.check(
  Schema.makeFilter((s: string) => URL.canParse(s.trim()), {
    expected: "a valid URL",
    toJsonSchema: () => ({ format: "uri" }),
  }),
);

const ISO_DATETIME_DATE_SOURCE = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
const ISO_DATETIME_PATTERN = `^${ISO_DATETIME_DATE_SOURCE}T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$`;
const ISO_DATETIME = new RegExp(ISO_DATETIME_PATTERN);

export const isoDateTimeString = orpcSchema(
  Schema.String.check(
    Schema.makeFilter((s: string) => ISO_DATETIME.test(s), {
      expected: "an ISO datetime string",
      toJsonSchema: () => ({ format: "date-time", pattern: ISO_DATETIME_PATTERN }),
    }),
  ),
);

const registryMetadataSchema = Schema.Struct({
  claimedBy: Schema.NullOr(Schema.String),
  title: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  repoUrl: Schema.NullOr(urlString),
  homepageUrl: Schema.NullOr(urlString),
  imageUrl: Schema.NullOr(urlString),
  updatedAt: Schema.NullOr(isoDateTimeString),
});

const registryAppSummaryFields = {
  accountId: Schema.String,
  gatewayId: Schema.String,
  canonicalKey: Schema.String,
  canonicalConfigUrl: urlString,
  startCommand: Schema.String,
  domain: Schema.NullOr(Schema.String),
  openUrl: Schema.NullOr(urlString),
  hostUrl: Schema.NullOr(urlString),
  uiUrl: Schema.NullOr(urlString),
  uiSsrUrl: Schema.NullOr(urlString),
  apiUrl: Schema.NullOr(urlString),
  extends: Schema.NullOr(Schema.String),
  parent: Schema.NullOr(Schema.String),
  root: Schema.NullOr(Schema.String),
  depth: Schema.Natural,
  status: Schema.Literals(["ready", "invalid"]),
  metadata: Schema.NullOr(registryMetadataSchema),
};

const registryAppSummarySchema = Schema.Struct(registryAppSummaryFields);

const registryAppDetailSchema = Schema.Struct({
  ...registryAppSummaryFields,
  metadataKey: Schema.String,
  metadataContractId: Schema.String,
  metadataFastKvUrl: urlString,
  extendsChain: Schema.Array(Schema.String),
  resolvedConfig: Schema.Record(Schema.String, Schema.Unknown),
});

const registryMetaSchema = Schema.Struct({
  total: Schema.Natural,
  hasMore: Schema.Boolean,
  nextCursor: Schema.NullOr(Schema.String),
});

const preparedRegistryMetadataWriteSchema = Schema.Struct({
  contractId: Schema.String,
  methodName: Schema.Literal("__fastdata_kv"),
  key: Schema.String,
  manifest: registryMetadataSchema,
  args: Schema.Record(Schema.String, Schema.String),
  gas: Schema.String,
  attachedDeposit: Schema.String,
});

const registryConfigWriteInputSchema = Schema.Struct({
  accountId: Schema.String,
  gatewayId: Schema.String,
  config: Schema.Record(Schema.String, Schema.Unknown),
});

const preparedRegistryConfigWriteSchema = Schema.Struct({
  contractId: Schema.String,
  methodName: Schema.Literal("__fastdata_kv"),
  key: Schema.String,
  args: Schema.Record(Schema.String, Schema.String),
  gas: Schema.String,
  attachedDeposit: Schema.String,
});

const registryRelayResultSchema = Schema.Struct({
  transactionHash: Schema.NullOr(Schema.String),
  relayerAccountId: Schema.String,
  senderId: Schema.String,
});

const kvEntrySchema = Schema.Struct({
  key: Schema.String,
  value: Schema.Unknown,
  blockHeight: Schema.optional(Schema.Number),
  blockTimestamp: Schema.optional(Schema.Number),
  txHash: Schema.optional(Schema.String),
  signerId: Schema.optional(Schema.String),
});

const preparedKvWriteSchema = Schema.Struct({
  contractId: Schema.String,
  methodName: Schema.Literal("__fastdata_kv"),
  args: Schema.Record(Schema.String, Schema.String),
  gas: Schema.String,
  attachedDeposit: Schema.String,
});

export const listRegistryAppsInput = orpcSchema(
  Schema.Struct({
    q: Schema.optional(Schema.String),
    parent: Schema.optional(Schema.String),
    root: Schema.optional(Schema.String),
    ancestor: Schema.optional(Schema.String),
    limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
    cursor: Schema.optional(Schema.String),
  }),
);

const listRegistryAppsOutput = orpcSchema(
  Schema.Struct({
    data: Schema.Array(registryAppSummarySchema),
    meta: registryMetaSchema,
  }),
);

const getRegistryAppsByAccountInput = orpcSchema(Schema.Struct({ accountId: Schema.String }));

const getRegistryAppInput = orpcSchema(
  Schema.Struct({
    accountId: Schema.String,
    gatewayId: Schema.String,
  }),
);

const getRegistryAppOutput = orpcSchema(Schema.Struct({ data: registryAppDetailSchema }));

export const getRegistryAppByHostInput = orpcSchema(Schema.Struct({ hostUrl: urlString }));

export const getRegistryStatusOutput = orpcSchema(
  Schema.Struct({
    discoveredApps: Schema.Natural,
    metadataContractId: Schema.String,
    metadataFastKvUrl: urlString,
    relayEnabled: Schema.Boolean,
    relayAccountId: Schema.NullOr(Schema.String),
    timestamp: isoDateTimeString,
  }),
);

export const getManifestInput = orpcSchema(
  Schema.Struct({
    ref: Schema.String.check(Schema.isStartingWith("bos://")),
    includeVersionRecord: Schema.optional(Schema.Boolean),
  }),
);

const getManifestOutput = orpcSchema(
  Schema.Struct({
    ref: Schema.String,
    tag: Schema.NullOr(Schema.Unknown),
    versionRecord: Schema.NullOr(Schema.Unknown),
  }),
);

export const resolveRuntimeInput = orpcSchema(
  Schema.Struct({
    ref: Schema.String.check(Schema.isStartingWith("bos://")),
    release: Schema.optional(Schema.String),
  }),
);

const resolveRuntimeOutput = orpcSchema(
  Schema.Struct({
    ref: Schema.String,
    outcome: Schema.Union([
      Schema.Struct({
        state: Schema.Literal("Resolved"),
        manifest: Schema.Record(Schema.String, Schema.Unknown),
        source: Schema.Struct({ account: Schema.String, gateway: Schema.String }),
        from: Schema.Literals(["version", "manifest", "cache"]),
        provenance: Schema.Literals(["record", "pointer"]),
        fromCache: Schema.Boolean,
      }),
      Schema.Struct({
        state: Schema.Literal("Unresolved"),
        reason: Schema.Literals(["absent", "unreachable", "integrityFailure"]),
        detail: Schema.optional(Schema.String),
        context: Schema.Record(Schema.String, Schema.Unknown),
      }),
    ]),
  }),
);

export const prepareRegistryMetadataWriteInput = orpcSchema(
  Schema.Struct({
    accountId: Schema.String,
    gatewayId: Schema.String,
    claimedBy: Schema.String,
    title: Schema.optional(Schema.String),
    description: Schema.optional(Schema.String),
    repoUrl: Schema.optional(urlString),
    homepageUrl: Schema.optional(urlString),
    imageUrl: Schema.optional(urlString),
  }),
);

const prepareRegistryMetadataWriteOutput = orpcSchema(
  Schema.Struct({ data: preparedRegistryMetadataWriteSchema }),
);

export const prepareRegistryConfigWriteInput = orpcSchema(registryConfigWriteInputSchema);

const prepareRegistryConfigWriteOutput = orpcSchema(
  Schema.Struct({ data: preparedRegistryConfigWriteSchema }),
);

export const relayRegistryMetadataWriteInput = orpcSchema(
  Schema.Struct({ payload: Schema.String }),
);

const relayRegistryMetadataWriteOutput = orpcSchema(
  Schema.Struct({ data: registryRelayResultSchema }),
);

export const kvGetInput = orpcSchema(Schema.Struct({ path: Schema.String }));

const kvGetOutput = orpcSchema(Schema.Struct({ data: Schema.NullOr(Schema.Unknown) }));

export const kvListInput = orpcSchema(
  Schema.Struct({
    prefix: Schema.String,
    limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 }))),
    cursor: Schema.optional(Schema.String),
  }),
);

const kvListOutput = orpcSchema(
  Schema.Struct({
    data: Schema.Array(kvEntrySchema),
    meta: registryMetaSchema,
  }),
);

export const kvPrepareWriteInput = orpcSchema(
  Schema.Struct({
    entries: Schema.mutable(
      Schema.Array(
        Schema.Struct({
          path: Schema.String,
          value: Schema.Unknown,
        }),
      ),
    ),
  }),
);

const kvPrepareWriteOutput = orpcSchema(Schema.Struct({ data: preparedKvWriteSchema }));

export const kvRelayWriteInput = orpcSchema(Schema.Struct({ payload: Schema.String }));

const kvRelayWriteOutput = orpcSchema(Schema.Struct({ data: registryRelayResultSchema }));

export const contract = oc.router({
  listRegistryApps: oc
    .route({ method: "GET", path: "/v1/registry/apps" })
    .input(listRegistryAppsInput)
    .output(listRegistryAppsOutput)
    .errors({ BAD_REQUEST }),

  getRegistryAppsByAccount: oc
    .route({ method: "GET", path: "/v1/registry/apps/account/{accountId}" })
    .input(getRegistryAppsByAccountInput)
    .output(listRegistryAppsOutput)
    .errors({ NOT_FOUND }),

  getRegistryApp: oc
    .route({ method: "GET", path: "/v1/registry/apps/{accountId}/{gatewayId}" })
    .input(getRegistryAppInput)
    .output(getRegistryAppOutput)
    .errors({ NOT_FOUND }),

  getRegistryAppByHost: oc
    .route({ method: "GET", path: "/v1/registry/apps/by-host" })
    .input(getRegistryAppByHostInput)
    .output(getRegistryAppOutput)
    .errors({ NOT_FOUND }),

  getRegistryStatus: oc
    .route({ method: "GET", path: "/v1/registry/status" })
    .output(getRegistryStatusOutput),

  getManifest: oc
    .route({ method: "GET", path: "/v1/registry/manifest" })
    .input(getManifestInput)
    .output(getManifestOutput)
    .errors({ BAD_REQUEST }),

  resolveRuntime: oc
    .route({ method: "GET", path: "/v1/registry/resolve" })
    .input(resolveRuntimeInput)
    .output(resolveRuntimeOutput)
    .errors({ BAD_REQUEST }),

  prepareRegistryMetadataWrite: oc
    .route({ method: "POST", path: "/v1/registry/apps/{accountId}/{gatewayId}/metadata/prepare" })
    .input(prepareRegistryMetadataWriteInput)
    .output(prepareRegistryMetadataWriteOutput)
    .errors({ BAD_REQUEST }),

  prepareRegistryConfigWrite: oc
    .route({ method: "POST", path: "/v1/registry/apps/{accountId}/{gatewayId}/config/prepare" })
    .input(prepareRegistryConfigWriteInput)
    .output(prepareRegistryConfigWriteOutput)
    .errors({ BAD_REQUEST }),

  relayRegistryMetadataWrite: oc
    .route({ method: "POST", path: "/v1/registry/metadata/relay" })
    .input(relayRegistryMetadataWriteInput)
    .output(relayRegistryMetadataWriteOutput)
    .errors({ BAD_REQUEST, FORBIDDEN, UNAUTHORIZED }),

  kvGet: oc
    .route({ method: "GET", path: "/v1/kv" })
    .input(kvGetInput)
    .output(kvGetOutput)
    .errors({ NOT_FOUND }),

  kvList: oc
    .route({ method: "GET", path: "/v1/kv/list" })
    .input(kvListInput)
    .output(kvListOutput)
    .errors({ BAD_REQUEST }),

  kvPrepareWrite: oc
    .route({ method: "POST", path: "/v1/kv/prepare" })
    .input(kvPrepareWriteInput)
    .output(kvPrepareWriteOutput)
    .errors({ BAD_REQUEST }),

  kvRelayWrite: oc
    .route({ method: "POST", path: "/v1/kv/relay" })
    .input(kvRelayWriteInput)
    .output(kvRelayWriteOutput)
    .errors({ BAD_REQUEST, FORBIDDEN, UNAUTHORIZED }),
});

export type ContractType = typeof contract;
