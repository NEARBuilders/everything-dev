import "@orpc/openapi/extensions/route";
import { Schema } from "effect";
declare const isoDateTimeString: Schema.String;
export { isoDateTimeString };
export declare const listRegistryAppsInput: import("effect/StandardSchema").StandardJSONSchemaV1<{
    readonly q?: string | undefined;
    readonly parent?: string | undefined;
    readonly root?: string | undefined;
    readonly ancestor?: string | undefined;
    readonly limit?: number | undefined;
    readonly cursor?: string | undefined;
}, {
    readonly q?: string | undefined;
    readonly parent?: string | undefined;
    readonly root?: string | undefined;
    readonly ancestor?: string | undefined;
    readonly limit?: number | undefined;
    readonly cursor?: string | undefined;
}> & import("effect/StandardSchema").StandardSchemaV1<{
    readonly q?: string | undefined;
    readonly parent?: string | undefined;
    readonly root?: string | undefined;
    readonly ancestor?: string | undefined;
    readonly limit?: number | undefined;
    readonly cursor?: string | undefined;
}, {
    readonly q?: string | undefined;
    readonly parent?: string | undefined;
    readonly root?: string | undefined;
    readonly ancestor?: string | undefined;
    readonly limit?: number | undefined;
    readonly cursor?: string | undefined;
}> & Schema.Struct<{
    readonly q: Schema.optional<Schema.String>;
    readonly parent: Schema.optional<Schema.String>;
    readonly root: Schema.optional<Schema.String>;
    readonly ancestor: Schema.optional<Schema.String>;
    readonly limit: Schema.optional<Schema.Int>;
    readonly cursor: Schema.optional<Schema.String>;
}>;
export declare const getRegistryAppByHostInput: import("effect/StandardSchema").StandardJSONSchemaV1<{
    readonly hostUrl: string;
}, {
    readonly hostUrl: string;
}> & import("effect/StandardSchema").StandardSchemaV1<{
    readonly hostUrl: string;
}, {
    readonly hostUrl: string;
}> & Schema.Struct<{
    readonly hostUrl: Schema.String;
}>;
export declare const getRegistryStatusOutput: import("effect/StandardSchema").StandardJSONSchemaV1<{
    readonly discoveredApps: number;
    readonly metadataContractId: string;
    readonly metadataFastKvUrl: string;
    readonly relayEnabled: boolean;
    readonly relayAccountId: string | null;
    readonly timestamp: string;
}, {
    readonly discoveredApps: number;
    readonly metadataContractId: string;
    readonly metadataFastKvUrl: string;
    readonly relayEnabled: boolean;
    readonly relayAccountId: string | null;
    readonly timestamp: string;
}> & import("effect/StandardSchema").StandardSchemaV1<{
    readonly discoveredApps: number;
    readonly metadataContractId: string;
    readonly metadataFastKvUrl: string;
    readonly relayEnabled: boolean;
    readonly relayAccountId: string | null;
    readonly timestamp: string;
}, {
    readonly discoveredApps: number;
    readonly metadataContractId: string;
    readonly metadataFastKvUrl: string;
    readonly relayEnabled: boolean;
    readonly relayAccountId: string | null;
    readonly timestamp: string;
}> & Schema.Struct<{
    readonly discoveredApps: Schema.Natural;
    readonly metadataContractId: Schema.String;
    readonly metadataFastKvUrl: Schema.String;
    readonly relayEnabled: Schema.Boolean;
    readonly relayAccountId: Schema.NullOr<Schema.String>;
    readonly timestamp: Schema.String;
}>;
export declare const getManifestInput: import("effect/StandardSchema").StandardJSONSchemaV1<{
    readonly ref: string;
    readonly includeVersionRecord?: boolean | undefined;
}, {
    readonly ref: string;
    readonly includeVersionRecord?: boolean | undefined;
}> & import("effect/StandardSchema").StandardSchemaV1<{
    readonly ref: string;
    readonly includeVersionRecord?: boolean | undefined;
}, {
    readonly ref: string;
    readonly includeVersionRecord?: boolean | undefined;
}> & Schema.Struct<{
    readonly ref: Schema.String;
    readonly includeVersionRecord: Schema.optional<Schema.Boolean>;
}>;
export declare const resolveRuntimeInput: import("effect/StandardSchema").StandardJSONSchemaV1<{
    readonly ref: string;
    readonly release?: string | undefined;
}, {
    readonly ref: string;
    readonly release?: string | undefined;
}> & import("effect/StandardSchema").StandardSchemaV1<{
    readonly ref: string;
    readonly release?: string | undefined;
}, {
    readonly ref: string;
    readonly release?: string | undefined;
}> & Schema.Struct<{
    readonly ref: Schema.String;
    readonly release: Schema.optional<Schema.String>;
}>;
export declare const prepareRegistryMetadataWriteInput: import("effect/StandardSchema").StandardJSONSchemaV1<{
    readonly accountId: string;
    readonly gatewayId: string;
    readonly claimedBy: string;
    readonly title?: string | undefined;
    readonly description?: string | undefined;
    readonly repoUrl?: string | undefined;
    readonly homepageUrl?: string | undefined;
    readonly imageUrl?: string | undefined;
}, {
    readonly accountId: string;
    readonly gatewayId: string;
    readonly claimedBy: string;
    readonly title?: string | undefined;
    readonly description?: string | undefined;
    readonly repoUrl?: string | undefined;
    readonly homepageUrl?: string | undefined;
    readonly imageUrl?: string | undefined;
}> & import("effect/StandardSchema").StandardSchemaV1<{
    readonly accountId: string;
    readonly gatewayId: string;
    readonly claimedBy: string;
    readonly title?: string | undefined;
    readonly description?: string | undefined;
    readonly repoUrl?: string | undefined;
    readonly homepageUrl?: string | undefined;
    readonly imageUrl?: string | undefined;
}, {
    readonly accountId: string;
    readonly gatewayId: string;
    readonly claimedBy: string;
    readonly title?: string | undefined;
    readonly description?: string | undefined;
    readonly repoUrl?: string | undefined;
    readonly homepageUrl?: string | undefined;
    readonly imageUrl?: string | undefined;
}> & Schema.Struct<{
    readonly accountId: Schema.String;
    readonly gatewayId: Schema.String;
    readonly claimedBy: Schema.String;
    readonly title: Schema.optional<Schema.String>;
    readonly description: Schema.optional<Schema.String>;
    readonly repoUrl: Schema.optional<Schema.String>;
    readonly homepageUrl: Schema.optional<Schema.String>;
    readonly imageUrl: Schema.optional<Schema.String>;
}>;
export declare const prepareRegistryConfigWriteInput: import("effect/StandardSchema").StandardJSONSchemaV1<{
    readonly accountId: string;
    readonly gatewayId: string;
    readonly config: {
        readonly [x: string]: unknown;
    };
}, {
    readonly accountId: string;
    readonly gatewayId: string;
    readonly config: {
        readonly [x: string]: unknown;
    };
}> & import("effect/StandardSchema").StandardSchemaV1<{
    readonly accountId: string;
    readonly gatewayId: string;
    readonly config: {
        readonly [x: string]: unknown;
    };
}, {
    readonly accountId: string;
    readonly gatewayId: string;
    readonly config: {
        readonly [x: string]: unknown;
    };
}> & Schema.Struct<{
    readonly accountId: Schema.String;
    readonly gatewayId: Schema.String;
    readonly config: Schema.$Record<Schema.String, Schema.Unknown>;
}>;
export declare const relayRegistryMetadataWriteInput: import("effect/StandardSchema").StandardJSONSchemaV1<{
    readonly payload: string;
}, {
    readonly payload: string;
}> & import("effect/StandardSchema").StandardSchemaV1<{
    readonly payload: string;
}, {
    readonly payload: string;
}> & Schema.Struct<{
    readonly payload: Schema.String;
}>;
export declare const kvGetInput: import("effect/StandardSchema").StandardJSONSchemaV1<{
    readonly path: string;
}, {
    readonly path: string;
}> & import("effect/StandardSchema").StandardSchemaV1<{
    readonly path: string;
}, {
    readonly path: string;
}> & Schema.Struct<{
    readonly path: Schema.String;
}>;
export declare const kvListInput: import("effect/StandardSchema").StandardJSONSchemaV1<{
    readonly prefix: string;
    readonly limit?: number | undefined;
    readonly cursor?: string | undefined;
}, {
    readonly prefix: string;
    readonly limit?: number | undefined;
    readonly cursor?: string | undefined;
}> & import("effect/StandardSchema").StandardSchemaV1<{
    readonly prefix: string;
    readonly limit?: number | undefined;
    readonly cursor?: string | undefined;
}, {
    readonly prefix: string;
    readonly limit?: number | undefined;
    readonly cursor?: string | undefined;
}> & Schema.Struct<{
    readonly prefix: Schema.String;
    readonly limit: Schema.optional<Schema.Int>;
    readonly cursor: Schema.optional<Schema.String>;
}>;
export declare const kvPrepareWriteInput: import("effect/StandardSchema").StandardJSONSchemaV1<{
    readonly entries: {
        readonly path: string;
        readonly value: unknown;
    }[];
}, {
    readonly entries: {
        readonly path: string;
        readonly value: unknown;
    }[];
}> & import("effect/StandardSchema").StandardSchemaV1<{
    readonly entries: {
        readonly path: string;
        readonly value: unknown;
    }[];
}, {
    readonly entries: {
        readonly path: string;
        readonly value: unknown;
    }[];
}> & Schema.Struct<{
    readonly entries: Schema.mutable<Schema.$Array<Schema.Struct<{
        readonly path: Schema.String;
        readonly value: Schema.Unknown;
    }>>>;
}>;
export declare const kvRelayWriteInput: import("effect/StandardSchema").StandardJSONSchemaV1<{
    readonly payload: string;
}, {
    readonly payload: string;
}> & import("effect/StandardSchema").StandardSchemaV1<{
    readonly payload: string;
}, {
    readonly payload: string;
}> & Schema.Struct<{
    readonly payload: Schema.String;
}>;
export declare const contract: {
    listRegistryApps: import("@orpc/contract").ProcedureContract<import("effect/StandardSchema").StandardJSONSchemaV1<{
        readonly q?: string | undefined;
        readonly parent?: string | undefined;
        readonly root?: string | undefined;
        readonly ancestor?: string | undefined;
        readonly limit?: number | undefined;
        readonly cursor?: string | undefined;
    }, {
        readonly q?: string | undefined;
        readonly parent?: string | undefined;
        readonly root?: string | undefined;
        readonly ancestor?: string | undefined;
        readonly limit?: number | undefined;
        readonly cursor?: string | undefined;
    }> & import("effect/StandardSchema").StandardSchemaV1<{
        readonly q?: string | undefined;
        readonly parent?: string | undefined;
        readonly root?: string | undefined;
        readonly ancestor?: string | undefined;
        readonly limit?: number | undefined;
        readonly cursor?: string | undefined;
    }, {
        readonly q?: string | undefined;
        readonly parent?: string | undefined;
        readonly root?: string | undefined;
        readonly ancestor?: string | undefined;
        readonly limit?: number | undefined;
        readonly cursor?: string | undefined;
    }> & Schema.Struct<{
        readonly q: Schema.optional<Schema.String>;
        readonly parent: Schema.optional<Schema.String>;
        readonly root: Schema.optional<Schema.String>;
        readonly ancestor: Schema.optional<Schema.String>;
        readonly limit: Schema.optional<Schema.Int>;
        readonly cursor: Schema.optional<Schema.String>;
    }>, import("effect/StandardSchema").StandardJSONSchemaV1<{
        readonly data: readonly {
            readonly accountId: string;
            readonly gatewayId: string;
            readonly canonicalKey: string;
            readonly canonicalConfigUrl: string;
            readonly startCommand: string;
            readonly domain: string | null;
            readonly openUrl: string | null;
            readonly hostUrl: string | null;
            readonly uiUrl: string | null;
            readonly uiSsrUrl: string | null;
            readonly apiUrl: string | null;
            readonly extends: string | null;
            readonly parent: string | null;
            readonly root: string | null;
            readonly depth: number;
            readonly status: "invalid" | "ready";
            readonly metadata: {
                readonly claimedBy: string | null;
                readonly title: string | null;
                readonly description: string | null;
                readonly repoUrl: string | null;
                readonly homepageUrl: string | null;
                readonly imageUrl: string | null;
                readonly updatedAt: string | null;
            } | null;
        }[];
        readonly meta: {
            readonly total: number;
            readonly hasMore: boolean;
            readonly nextCursor: string | null;
        };
    }, {
        readonly data: readonly {
            readonly accountId: string;
            readonly gatewayId: string;
            readonly canonicalKey: string;
            readonly canonicalConfigUrl: string;
            readonly startCommand: string;
            readonly domain: string | null;
            readonly openUrl: string | null;
            readonly hostUrl: string | null;
            readonly uiUrl: string | null;
            readonly uiSsrUrl: string | null;
            readonly apiUrl: string | null;
            readonly extends: string | null;
            readonly parent: string | null;
            readonly root: string | null;
            readonly depth: number;
            readonly status: "invalid" | "ready";
            readonly metadata: {
                readonly claimedBy: string | null;
                readonly title: string | null;
                readonly description: string | null;
                readonly repoUrl: string | null;
                readonly homepageUrl: string | null;
                readonly imageUrl: string | null;
                readonly updatedAt: string | null;
            } | null;
        }[];
        readonly meta: {
            readonly total: number;
            readonly hasMore: boolean;
            readonly nextCursor: string | null;
        };
    }> & import("effect/StandardSchema").StandardSchemaV1<{
        readonly data: readonly {
            readonly accountId: string;
            readonly gatewayId: string;
            readonly canonicalKey: string;
            readonly canonicalConfigUrl: string;
            readonly startCommand: string;
            readonly domain: string | null;
            readonly openUrl: string | null;
            readonly hostUrl: string | null;
            readonly uiUrl: string | null;
            readonly uiSsrUrl: string | null;
            readonly apiUrl: string | null;
            readonly extends: string | null;
            readonly parent: string | null;
            readonly root: string | null;
            readonly depth: number;
            readonly status: "invalid" | "ready";
            readonly metadata: {
                readonly claimedBy: string | null;
                readonly title: string | null;
                readonly description: string | null;
                readonly repoUrl: string | null;
                readonly homepageUrl: string | null;
                readonly imageUrl: string | null;
                readonly updatedAt: string | null;
            } | null;
        }[];
        readonly meta: {
            readonly total: number;
            readonly hasMore: boolean;
            readonly nextCursor: string | null;
        };
    }, {
        readonly data: readonly {
            readonly accountId: string;
            readonly gatewayId: string;
            readonly canonicalKey: string;
            readonly canonicalConfigUrl: string;
            readonly startCommand: string;
            readonly domain: string | null;
            readonly openUrl: string | null;
            readonly hostUrl: string | null;
            readonly uiUrl: string | null;
            readonly uiSsrUrl: string | null;
            readonly apiUrl: string | null;
            readonly extends: string | null;
            readonly parent: string | null;
            readonly root: string | null;
            readonly depth: number;
            readonly status: "invalid" | "ready";
            readonly metadata: {
                readonly claimedBy: string | null;
                readonly title: string | null;
                readonly description: string | null;
                readonly repoUrl: string | null;
                readonly homepageUrl: string | null;
                readonly imageUrl: string | null;
                readonly updatedAt: string | null;
            } | null;
        }[];
        readonly meta: {
            readonly total: number;
            readonly hasMore: boolean;
            readonly nextCursor: string | null;
        };
    }> & Schema.Struct<{
        readonly data: Schema.$Array<Schema.Struct<{
            accountId: Schema.String;
            gatewayId: Schema.String;
            canonicalKey: Schema.String;
            canonicalConfigUrl: Schema.String;
            startCommand: Schema.String;
            domain: Schema.NullOr<Schema.String>;
            openUrl: Schema.NullOr<Schema.String>;
            hostUrl: Schema.NullOr<Schema.String>;
            uiUrl: Schema.NullOr<Schema.String>;
            uiSsrUrl: Schema.NullOr<Schema.String>;
            apiUrl: Schema.NullOr<Schema.String>;
            extends: Schema.NullOr<Schema.String>;
            parent: Schema.NullOr<Schema.String>;
            root: Schema.NullOr<Schema.String>;
            depth: Schema.Natural;
            status: Schema.Literals<readonly ["ready", "invalid"]>;
            metadata: Schema.NullOr<Schema.Struct<{
                readonly claimedBy: Schema.NullOr<Schema.String>;
                readonly title: Schema.NullOr<Schema.String>;
                readonly description: Schema.NullOr<Schema.String>;
                readonly repoUrl: Schema.NullOr<Schema.String>;
                readonly homepageUrl: Schema.NullOr<Schema.String>;
                readonly imageUrl: Schema.NullOr<Schema.String>;
                readonly updatedAt: Schema.NullOr<Schema.String>;
            }>>;
        }>>;
        readonly meta: Schema.Struct<{
            readonly total: Schema.Natural;
            readonly hasMore: Schema.Boolean;
            readonly nextCursor: Schema.NullOr<Schema.String>;
        }>;
    }>, {
        BAD_REQUEST: {
            readonly status: 400;
            readonly data: import("zod").ZodObject<{
                invalidFields: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString>>;
                validationErrors: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodObject<{
                    field: import("zod").ZodString;
                    message: import("zod").ZodString;
                    code: import("zod").ZodOptional<import("zod").ZodString>;
                }, import("zod/v4/core").$strip>>>;
            }, import("zod/v4/core").$strip>;
        };
    }>;
    getRegistryAppsByAccount: import("@orpc/contract").ProcedureContract<import("effect/StandardSchema").StandardJSONSchemaV1<{
        readonly accountId: string;
    }, {
        readonly accountId: string;
    }> & import("effect/StandardSchema").StandardSchemaV1<{
        readonly accountId: string;
    }, {
        readonly accountId: string;
    }> & Schema.Struct<{
        readonly accountId: Schema.String;
    }>, import("effect/StandardSchema").StandardJSONSchemaV1<{
        readonly data: readonly {
            readonly accountId: string;
            readonly gatewayId: string;
            readonly canonicalKey: string;
            readonly canonicalConfigUrl: string;
            readonly startCommand: string;
            readonly domain: string | null;
            readonly openUrl: string | null;
            readonly hostUrl: string | null;
            readonly uiUrl: string | null;
            readonly uiSsrUrl: string | null;
            readonly apiUrl: string | null;
            readonly extends: string | null;
            readonly parent: string | null;
            readonly root: string | null;
            readonly depth: number;
            readonly status: "invalid" | "ready";
            readonly metadata: {
                readonly claimedBy: string | null;
                readonly title: string | null;
                readonly description: string | null;
                readonly repoUrl: string | null;
                readonly homepageUrl: string | null;
                readonly imageUrl: string | null;
                readonly updatedAt: string | null;
            } | null;
        }[];
        readonly meta: {
            readonly total: number;
            readonly hasMore: boolean;
            readonly nextCursor: string | null;
        };
    }, {
        readonly data: readonly {
            readonly accountId: string;
            readonly gatewayId: string;
            readonly canonicalKey: string;
            readonly canonicalConfigUrl: string;
            readonly startCommand: string;
            readonly domain: string | null;
            readonly openUrl: string | null;
            readonly hostUrl: string | null;
            readonly uiUrl: string | null;
            readonly uiSsrUrl: string | null;
            readonly apiUrl: string | null;
            readonly extends: string | null;
            readonly parent: string | null;
            readonly root: string | null;
            readonly depth: number;
            readonly status: "invalid" | "ready";
            readonly metadata: {
                readonly claimedBy: string | null;
                readonly title: string | null;
                readonly description: string | null;
                readonly repoUrl: string | null;
                readonly homepageUrl: string | null;
                readonly imageUrl: string | null;
                readonly updatedAt: string | null;
            } | null;
        }[];
        readonly meta: {
            readonly total: number;
            readonly hasMore: boolean;
            readonly nextCursor: string | null;
        };
    }> & import("effect/StandardSchema").StandardSchemaV1<{
        readonly data: readonly {
            readonly accountId: string;
            readonly gatewayId: string;
            readonly canonicalKey: string;
            readonly canonicalConfigUrl: string;
            readonly startCommand: string;
            readonly domain: string | null;
            readonly openUrl: string | null;
            readonly hostUrl: string | null;
            readonly uiUrl: string | null;
            readonly uiSsrUrl: string | null;
            readonly apiUrl: string | null;
            readonly extends: string | null;
            readonly parent: string | null;
            readonly root: string | null;
            readonly depth: number;
            readonly status: "invalid" | "ready";
            readonly metadata: {
                readonly claimedBy: string | null;
                readonly title: string | null;
                readonly description: string | null;
                readonly repoUrl: string | null;
                readonly homepageUrl: string | null;
                readonly imageUrl: string | null;
                readonly updatedAt: string | null;
            } | null;
        }[];
        readonly meta: {
            readonly total: number;
            readonly hasMore: boolean;
            readonly nextCursor: string | null;
        };
    }, {
        readonly data: readonly {
            readonly accountId: string;
            readonly gatewayId: string;
            readonly canonicalKey: string;
            readonly canonicalConfigUrl: string;
            readonly startCommand: string;
            readonly domain: string | null;
            readonly openUrl: string | null;
            readonly hostUrl: string | null;
            readonly uiUrl: string | null;
            readonly uiSsrUrl: string | null;
            readonly apiUrl: string | null;
            readonly extends: string | null;
            readonly parent: string | null;
            readonly root: string | null;
            readonly depth: number;
            readonly status: "invalid" | "ready";
            readonly metadata: {
                readonly claimedBy: string | null;
                readonly title: string | null;
                readonly description: string | null;
                readonly repoUrl: string | null;
                readonly homepageUrl: string | null;
                readonly imageUrl: string | null;
                readonly updatedAt: string | null;
            } | null;
        }[];
        readonly meta: {
            readonly total: number;
            readonly hasMore: boolean;
            readonly nextCursor: string | null;
        };
    }> & Schema.Struct<{
        readonly data: Schema.$Array<Schema.Struct<{
            accountId: Schema.String;
            gatewayId: Schema.String;
            canonicalKey: Schema.String;
            canonicalConfigUrl: Schema.String;
            startCommand: Schema.String;
            domain: Schema.NullOr<Schema.String>;
            openUrl: Schema.NullOr<Schema.String>;
            hostUrl: Schema.NullOr<Schema.String>;
            uiUrl: Schema.NullOr<Schema.String>;
            uiSsrUrl: Schema.NullOr<Schema.String>;
            apiUrl: Schema.NullOr<Schema.String>;
            extends: Schema.NullOr<Schema.String>;
            parent: Schema.NullOr<Schema.String>;
            root: Schema.NullOr<Schema.String>;
            depth: Schema.Natural;
            status: Schema.Literals<readonly ["ready", "invalid"]>;
            metadata: Schema.NullOr<Schema.Struct<{
                readonly claimedBy: Schema.NullOr<Schema.String>;
                readonly title: Schema.NullOr<Schema.String>;
                readonly description: Schema.NullOr<Schema.String>;
                readonly repoUrl: Schema.NullOr<Schema.String>;
                readonly homepageUrl: Schema.NullOr<Schema.String>;
                readonly imageUrl: Schema.NullOr<Schema.String>;
                readonly updatedAt: Schema.NullOr<Schema.String>;
            }>>;
        }>>;
        readonly meta: Schema.Struct<{
            readonly total: Schema.Natural;
            readonly hasMore: Schema.Boolean;
            readonly nextCursor: Schema.NullOr<Schema.String>;
        }>;
    }>, {
        NOT_FOUND: {
            readonly status: 404;
            readonly data: import("zod").ZodObject<{
                resource: import("zod").ZodOptional<import("zod").ZodString>;
                resourceId: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
        };
    }>;
    getRegistryApp: import("@orpc/contract").ProcedureContract<import("effect/StandardSchema").StandardJSONSchemaV1<{
        readonly accountId: string;
        readonly gatewayId: string;
    }, {
        readonly accountId: string;
        readonly gatewayId: string;
    }> & import("effect/StandardSchema").StandardSchemaV1<{
        readonly accountId: string;
        readonly gatewayId: string;
    }, {
        readonly accountId: string;
        readonly gatewayId: string;
    }> & Schema.Struct<{
        readonly accountId: Schema.String;
        readonly gatewayId: Schema.String;
    }>, import("effect/StandardSchema").StandardJSONSchemaV1<{
        readonly data: {
            readonly accountId: string;
            readonly gatewayId: string;
            readonly canonicalKey: string;
            readonly canonicalConfigUrl: string;
            readonly startCommand: string;
            readonly domain: string | null;
            readonly openUrl: string | null;
            readonly hostUrl: string | null;
            readonly uiUrl: string | null;
            readonly uiSsrUrl: string | null;
            readonly apiUrl: string | null;
            readonly extends: string | null;
            readonly parent: string | null;
            readonly root: string | null;
            readonly depth: number;
            readonly status: "invalid" | "ready";
            readonly metadata: {
                readonly claimedBy: string | null;
                readonly title: string | null;
                readonly description: string | null;
                readonly repoUrl: string | null;
                readonly homepageUrl: string | null;
                readonly imageUrl: string | null;
                readonly updatedAt: string | null;
            } | null;
            readonly metadataKey: string;
            readonly metadataContractId: string;
            readonly metadataFastKvUrl: string;
            readonly extendsChain: readonly string[];
            readonly resolvedConfig: {
                readonly [x: string]: unknown;
            };
        };
    }, {
        readonly data: {
            readonly accountId: string;
            readonly gatewayId: string;
            readonly canonicalKey: string;
            readonly canonicalConfigUrl: string;
            readonly startCommand: string;
            readonly domain: string | null;
            readonly openUrl: string | null;
            readonly hostUrl: string | null;
            readonly uiUrl: string | null;
            readonly uiSsrUrl: string | null;
            readonly apiUrl: string | null;
            readonly extends: string | null;
            readonly parent: string | null;
            readonly root: string | null;
            readonly depth: number;
            readonly status: "invalid" | "ready";
            readonly metadata: {
                readonly claimedBy: string | null;
                readonly title: string | null;
                readonly description: string | null;
                readonly repoUrl: string | null;
                readonly homepageUrl: string | null;
                readonly imageUrl: string | null;
                readonly updatedAt: string | null;
            } | null;
            readonly metadataKey: string;
            readonly metadataContractId: string;
            readonly metadataFastKvUrl: string;
            readonly extendsChain: readonly string[];
            readonly resolvedConfig: {
                readonly [x: string]: unknown;
            };
        };
    }> & import("effect/StandardSchema").StandardSchemaV1<{
        readonly data: {
            readonly accountId: string;
            readonly gatewayId: string;
            readonly canonicalKey: string;
            readonly canonicalConfigUrl: string;
            readonly startCommand: string;
            readonly domain: string | null;
            readonly openUrl: string | null;
            readonly hostUrl: string | null;
            readonly uiUrl: string | null;
            readonly uiSsrUrl: string | null;
            readonly apiUrl: string | null;
            readonly extends: string | null;
            readonly parent: string | null;
            readonly root: string | null;
            readonly depth: number;
            readonly status: "invalid" | "ready";
            readonly metadata: {
                readonly claimedBy: string | null;
                readonly title: string | null;
                readonly description: string | null;
                readonly repoUrl: string | null;
                readonly homepageUrl: string | null;
                readonly imageUrl: string | null;
                readonly updatedAt: string | null;
            } | null;
            readonly metadataKey: string;
            readonly metadataContractId: string;
            readonly metadataFastKvUrl: string;
            readonly extendsChain: readonly string[];
            readonly resolvedConfig: {
                readonly [x: string]: unknown;
            };
        };
    }, {
        readonly data: {
            readonly accountId: string;
            readonly gatewayId: string;
            readonly canonicalKey: string;
            readonly canonicalConfigUrl: string;
            readonly startCommand: string;
            readonly domain: string | null;
            readonly openUrl: string | null;
            readonly hostUrl: string | null;
            readonly uiUrl: string | null;
            readonly uiSsrUrl: string | null;
            readonly apiUrl: string | null;
            readonly extends: string | null;
            readonly parent: string | null;
            readonly root: string | null;
            readonly depth: number;
            readonly status: "invalid" | "ready";
            readonly metadata: {
                readonly claimedBy: string | null;
                readonly title: string | null;
                readonly description: string | null;
                readonly repoUrl: string | null;
                readonly homepageUrl: string | null;
                readonly imageUrl: string | null;
                readonly updatedAt: string | null;
            } | null;
            readonly metadataKey: string;
            readonly metadataContractId: string;
            readonly metadataFastKvUrl: string;
            readonly extendsChain: readonly string[];
            readonly resolvedConfig: {
                readonly [x: string]: unknown;
            };
        };
    }> & Schema.Struct<{
        readonly data: Schema.Struct<{
            readonly accountId: Schema.String;
            readonly gatewayId: Schema.String;
            readonly canonicalKey: Schema.String;
            readonly canonicalConfigUrl: Schema.String;
            readonly startCommand: Schema.String;
            readonly domain: Schema.NullOr<Schema.String>;
            readonly openUrl: Schema.NullOr<Schema.String>;
            readonly hostUrl: Schema.NullOr<Schema.String>;
            readonly uiUrl: Schema.NullOr<Schema.String>;
            readonly uiSsrUrl: Schema.NullOr<Schema.String>;
            readonly apiUrl: Schema.NullOr<Schema.String>;
            readonly extends: Schema.NullOr<Schema.String>;
            readonly parent: Schema.NullOr<Schema.String>;
            readonly root: Schema.NullOr<Schema.String>;
            readonly depth: Schema.Natural;
            readonly status: Schema.Literals<readonly ["ready", "invalid"]>;
            readonly metadata: Schema.NullOr<Schema.Struct<{
                readonly claimedBy: Schema.NullOr<Schema.String>;
                readonly title: Schema.NullOr<Schema.String>;
                readonly description: Schema.NullOr<Schema.String>;
                readonly repoUrl: Schema.NullOr<Schema.String>;
                readonly homepageUrl: Schema.NullOr<Schema.String>;
                readonly imageUrl: Schema.NullOr<Schema.String>;
                readonly updatedAt: Schema.NullOr<Schema.String>;
            }>>;
            readonly metadataKey: Schema.String;
            readonly metadataContractId: Schema.String;
            readonly metadataFastKvUrl: Schema.String;
            readonly extendsChain: Schema.$Array<Schema.String>;
            readonly resolvedConfig: Schema.$Record<Schema.String, Schema.Unknown>;
        }>;
    }>, {
        NOT_FOUND: {
            readonly status: 404;
            readonly data: import("zod").ZodObject<{
                resource: import("zod").ZodOptional<import("zod").ZodString>;
                resourceId: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
        };
    }>;
    getRegistryAppByHost: import("@orpc/contract").ProcedureContract<import("effect/StandardSchema").StandardJSONSchemaV1<{
        readonly hostUrl: string;
    }, {
        readonly hostUrl: string;
    }> & import("effect/StandardSchema").StandardSchemaV1<{
        readonly hostUrl: string;
    }, {
        readonly hostUrl: string;
    }> & Schema.Struct<{
        readonly hostUrl: Schema.String;
    }>, import("effect/StandardSchema").StandardJSONSchemaV1<{
        readonly data: {
            readonly accountId: string;
            readonly gatewayId: string;
            readonly canonicalKey: string;
            readonly canonicalConfigUrl: string;
            readonly startCommand: string;
            readonly domain: string | null;
            readonly openUrl: string | null;
            readonly hostUrl: string | null;
            readonly uiUrl: string | null;
            readonly uiSsrUrl: string | null;
            readonly apiUrl: string | null;
            readonly extends: string | null;
            readonly parent: string | null;
            readonly root: string | null;
            readonly depth: number;
            readonly status: "invalid" | "ready";
            readonly metadata: {
                readonly claimedBy: string | null;
                readonly title: string | null;
                readonly description: string | null;
                readonly repoUrl: string | null;
                readonly homepageUrl: string | null;
                readonly imageUrl: string | null;
                readonly updatedAt: string | null;
            } | null;
            readonly metadataKey: string;
            readonly metadataContractId: string;
            readonly metadataFastKvUrl: string;
            readonly extendsChain: readonly string[];
            readonly resolvedConfig: {
                readonly [x: string]: unknown;
            };
        };
    }, {
        readonly data: {
            readonly accountId: string;
            readonly gatewayId: string;
            readonly canonicalKey: string;
            readonly canonicalConfigUrl: string;
            readonly startCommand: string;
            readonly domain: string | null;
            readonly openUrl: string | null;
            readonly hostUrl: string | null;
            readonly uiUrl: string | null;
            readonly uiSsrUrl: string | null;
            readonly apiUrl: string | null;
            readonly extends: string | null;
            readonly parent: string | null;
            readonly root: string | null;
            readonly depth: number;
            readonly status: "invalid" | "ready";
            readonly metadata: {
                readonly claimedBy: string | null;
                readonly title: string | null;
                readonly description: string | null;
                readonly repoUrl: string | null;
                readonly homepageUrl: string | null;
                readonly imageUrl: string | null;
                readonly updatedAt: string | null;
            } | null;
            readonly metadataKey: string;
            readonly metadataContractId: string;
            readonly metadataFastKvUrl: string;
            readonly extendsChain: readonly string[];
            readonly resolvedConfig: {
                readonly [x: string]: unknown;
            };
        };
    }> & import("effect/StandardSchema").StandardSchemaV1<{
        readonly data: {
            readonly accountId: string;
            readonly gatewayId: string;
            readonly canonicalKey: string;
            readonly canonicalConfigUrl: string;
            readonly startCommand: string;
            readonly domain: string | null;
            readonly openUrl: string | null;
            readonly hostUrl: string | null;
            readonly uiUrl: string | null;
            readonly uiSsrUrl: string | null;
            readonly apiUrl: string | null;
            readonly extends: string | null;
            readonly parent: string | null;
            readonly root: string | null;
            readonly depth: number;
            readonly status: "invalid" | "ready";
            readonly metadata: {
                readonly claimedBy: string | null;
                readonly title: string | null;
                readonly description: string | null;
                readonly repoUrl: string | null;
                readonly homepageUrl: string | null;
                readonly imageUrl: string | null;
                readonly updatedAt: string | null;
            } | null;
            readonly metadataKey: string;
            readonly metadataContractId: string;
            readonly metadataFastKvUrl: string;
            readonly extendsChain: readonly string[];
            readonly resolvedConfig: {
                readonly [x: string]: unknown;
            };
        };
    }, {
        readonly data: {
            readonly accountId: string;
            readonly gatewayId: string;
            readonly canonicalKey: string;
            readonly canonicalConfigUrl: string;
            readonly startCommand: string;
            readonly domain: string | null;
            readonly openUrl: string | null;
            readonly hostUrl: string | null;
            readonly uiUrl: string | null;
            readonly uiSsrUrl: string | null;
            readonly apiUrl: string | null;
            readonly extends: string | null;
            readonly parent: string | null;
            readonly root: string | null;
            readonly depth: number;
            readonly status: "invalid" | "ready";
            readonly metadata: {
                readonly claimedBy: string | null;
                readonly title: string | null;
                readonly description: string | null;
                readonly repoUrl: string | null;
                readonly homepageUrl: string | null;
                readonly imageUrl: string | null;
                readonly updatedAt: string | null;
            } | null;
            readonly metadataKey: string;
            readonly metadataContractId: string;
            readonly metadataFastKvUrl: string;
            readonly extendsChain: readonly string[];
            readonly resolvedConfig: {
                readonly [x: string]: unknown;
            };
        };
    }> & Schema.Struct<{
        readonly data: Schema.Struct<{
            readonly accountId: Schema.String;
            readonly gatewayId: Schema.String;
            readonly canonicalKey: Schema.String;
            readonly canonicalConfigUrl: Schema.String;
            readonly startCommand: Schema.String;
            readonly domain: Schema.NullOr<Schema.String>;
            readonly openUrl: Schema.NullOr<Schema.String>;
            readonly hostUrl: Schema.NullOr<Schema.String>;
            readonly uiUrl: Schema.NullOr<Schema.String>;
            readonly uiSsrUrl: Schema.NullOr<Schema.String>;
            readonly apiUrl: Schema.NullOr<Schema.String>;
            readonly extends: Schema.NullOr<Schema.String>;
            readonly parent: Schema.NullOr<Schema.String>;
            readonly root: Schema.NullOr<Schema.String>;
            readonly depth: Schema.Natural;
            readonly status: Schema.Literals<readonly ["ready", "invalid"]>;
            readonly metadata: Schema.NullOr<Schema.Struct<{
                readonly claimedBy: Schema.NullOr<Schema.String>;
                readonly title: Schema.NullOr<Schema.String>;
                readonly description: Schema.NullOr<Schema.String>;
                readonly repoUrl: Schema.NullOr<Schema.String>;
                readonly homepageUrl: Schema.NullOr<Schema.String>;
                readonly imageUrl: Schema.NullOr<Schema.String>;
                readonly updatedAt: Schema.NullOr<Schema.String>;
            }>>;
            readonly metadataKey: Schema.String;
            readonly metadataContractId: Schema.String;
            readonly metadataFastKvUrl: Schema.String;
            readonly extendsChain: Schema.$Array<Schema.String>;
            readonly resolvedConfig: Schema.$Record<Schema.String, Schema.Unknown>;
        }>;
    }>, {
        NOT_FOUND: {
            readonly status: 404;
            readonly data: import("zod").ZodObject<{
                resource: import("zod").ZodOptional<import("zod").ZodString>;
                resourceId: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
        };
    }>;
    getRegistryStatus: import("@orpc/contract").ProcedureContract<import("@orpc/contract").InitialInputSchema, import("effect/StandardSchema").StandardJSONSchemaV1<{
        readonly discoveredApps: number;
        readonly metadataContractId: string;
        readonly metadataFastKvUrl: string;
        readonly relayEnabled: boolean;
        readonly relayAccountId: string | null;
        readonly timestamp: string;
    }, {
        readonly discoveredApps: number;
        readonly metadataContractId: string;
        readonly metadataFastKvUrl: string;
        readonly relayEnabled: boolean;
        readonly relayAccountId: string | null;
        readonly timestamp: string;
    }> & import("effect/StandardSchema").StandardSchemaV1<{
        readonly discoveredApps: number;
        readonly metadataContractId: string;
        readonly metadataFastKvUrl: string;
        readonly relayEnabled: boolean;
        readonly relayAccountId: string | null;
        readonly timestamp: string;
    }, {
        readonly discoveredApps: number;
        readonly metadataContractId: string;
        readonly metadataFastKvUrl: string;
        readonly relayEnabled: boolean;
        readonly relayAccountId: string | null;
        readonly timestamp: string;
    }> & Schema.Struct<{
        readonly discoveredApps: Schema.Natural;
        readonly metadataContractId: Schema.String;
        readonly metadataFastKvUrl: Schema.String;
        readonly relayEnabled: Schema.Boolean;
        readonly relayAccountId: Schema.NullOr<Schema.String>;
        readonly timestamp: Schema.String;
    }>, Record<never, never>>;
    getManifest: import("@orpc/contract").ProcedureContract<import("effect/StandardSchema").StandardJSONSchemaV1<{
        readonly ref: string;
        readonly includeVersionRecord?: boolean | undefined;
    }, {
        readonly ref: string;
        readonly includeVersionRecord?: boolean | undefined;
    }> & import("effect/StandardSchema").StandardSchemaV1<{
        readonly ref: string;
        readonly includeVersionRecord?: boolean | undefined;
    }, {
        readonly ref: string;
        readonly includeVersionRecord?: boolean | undefined;
    }> & Schema.Struct<{
        readonly ref: Schema.String;
        readonly includeVersionRecord: Schema.optional<Schema.Boolean>;
    }>, import("effect/StandardSchema").StandardJSONSchemaV1<{
        readonly ref: string;
        readonly tag: unknown;
        readonly versionRecord: unknown;
    }, {
        readonly ref: string;
        readonly tag: unknown;
        readonly versionRecord: unknown;
    }> & import("effect/StandardSchema").StandardSchemaV1<{
        readonly ref: string;
        readonly tag: unknown;
        readonly versionRecord: unknown;
    }, {
        readonly ref: string;
        readonly tag: unknown;
        readonly versionRecord: unknown;
    }> & Schema.Struct<{
        readonly ref: Schema.String;
        readonly tag: Schema.NullOr<Schema.Unknown>;
        readonly versionRecord: Schema.NullOr<Schema.Unknown>;
    }>, {
        BAD_REQUEST: {
            readonly status: 400;
            readonly data: import("zod").ZodObject<{
                invalidFields: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString>>;
                validationErrors: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodObject<{
                    field: import("zod").ZodString;
                    message: import("zod").ZodString;
                    code: import("zod").ZodOptional<import("zod").ZodString>;
                }, import("zod/v4/core").$strip>>>;
            }, import("zod/v4/core").$strip>;
        };
    }>;
    resolveRuntime: import("@orpc/contract").ProcedureContract<import("effect/StandardSchema").StandardJSONSchemaV1<{
        readonly ref: string;
        readonly release?: string | undefined;
    }, {
        readonly ref: string;
        readonly release?: string | undefined;
    }> & import("effect/StandardSchema").StandardSchemaV1<{
        readonly ref: string;
        readonly release?: string | undefined;
    }, {
        readonly ref: string;
        readonly release?: string | undefined;
    }> & Schema.Struct<{
        readonly ref: Schema.String;
        readonly release: Schema.optional<Schema.String>;
    }>, import("effect/StandardSchema").StandardJSONSchemaV1<{
        readonly ref: string;
        readonly outcome: {
            readonly state: "Resolved";
            readonly manifest: {
                readonly [x: string]: unknown;
            };
            readonly source: {
                readonly account: string;
                readonly gateway: string;
            };
            readonly from: "cache" | "manifest" | "version";
            readonly provenance: "pointer" | "record";
            readonly fromCache: boolean;
        } | {
            readonly state: "Unresolved";
            readonly reason: "absent" | "integrityFailure" | "unreachable";
            readonly detail?: string | undefined;
            readonly context: {
                readonly [x: string]: unknown;
            };
        };
    }, {
        readonly ref: string;
        readonly outcome: {
            readonly state: "Resolved";
            readonly manifest: {
                readonly [x: string]: unknown;
            };
            readonly source: {
                readonly account: string;
                readonly gateway: string;
            };
            readonly from: "cache" | "manifest" | "version";
            readonly provenance: "pointer" | "record";
            readonly fromCache: boolean;
        } | {
            readonly state: "Unresolved";
            readonly reason: "absent" | "integrityFailure" | "unreachable";
            readonly detail?: string | undefined;
            readonly context: {
                readonly [x: string]: unknown;
            };
        };
    }> & import("effect/StandardSchema").StandardSchemaV1<{
        readonly ref: string;
        readonly outcome: {
            readonly state: "Resolved";
            readonly manifest: {
                readonly [x: string]: unknown;
            };
            readonly source: {
                readonly account: string;
                readonly gateway: string;
            };
            readonly from: "cache" | "manifest" | "version";
            readonly provenance: "pointer" | "record";
            readonly fromCache: boolean;
        } | {
            readonly state: "Unresolved";
            readonly reason: "absent" | "integrityFailure" | "unreachable";
            readonly detail?: string | undefined;
            readonly context: {
                readonly [x: string]: unknown;
            };
        };
    }, {
        readonly ref: string;
        readonly outcome: {
            readonly state: "Resolved";
            readonly manifest: {
                readonly [x: string]: unknown;
            };
            readonly source: {
                readonly account: string;
                readonly gateway: string;
            };
            readonly from: "cache" | "manifest" | "version";
            readonly provenance: "pointer" | "record";
            readonly fromCache: boolean;
        } | {
            readonly state: "Unresolved";
            readonly reason: "absent" | "integrityFailure" | "unreachable";
            readonly detail?: string | undefined;
            readonly context: {
                readonly [x: string]: unknown;
            };
        };
    }> & Schema.Struct<{
        readonly ref: Schema.String;
        readonly outcome: Schema.Union<readonly [Schema.Struct<{
            readonly state: Schema.Literal<"Resolved">;
            readonly manifest: Schema.$Record<Schema.String, Schema.Unknown>;
            readonly source: Schema.Struct<{
                readonly account: Schema.String;
                readonly gateway: Schema.String;
            }>;
            readonly from: Schema.Literals<readonly ["version", "manifest", "cache"]>;
            readonly provenance: Schema.Literals<readonly ["record", "pointer"]>;
            readonly fromCache: Schema.Boolean;
        }>, Schema.Struct<{
            readonly state: Schema.Literal<"Unresolved">;
            readonly reason: Schema.Literals<readonly ["absent", "unreachable", "integrityFailure"]>;
            readonly detail: Schema.optional<Schema.String>;
            readonly context: Schema.$Record<Schema.String, Schema.Unknown>;
        }>]>;
    }>, {
        BAD_REQUEST: {
            readonly status: 400;
            readonly data: import("zod").ZodObject<{
                invalidFields: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString>>;
                validationErrors: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodObject<{
                    field: import("zod").ZodString;
                    message: import("zod").ZodString;
                    code: import("zod").ZodOptional<import("zod").ZodString>;
                }, import("zod/v4/core").$strip>>>;
            }, import("zod/v4/core").$strip>;
        };
    }>;
    prepareRegistryMetadataWrite: import("@orpc/contract").ProcedureContract<import("effect/StandardSchema").StandardJSONSchemaV1<{
        readonly accountId: string;
        readonly gatewayId: string;
        readonly claimedBy: string;
        readonly title?: string | undefined;
        readonly description?: string | undefined;
        readonly repoUrl?: string | undefined;
        readonly homepageUrl?: string | undefined;
        readonly imageUrl?: string | undefined;
    }, {
        readonly accountId: string;
        readonly gatewayId: string;
        readonly claimedBy: string;
        readonly title?: string | undefined;
        readonly description?: string | undefined;
        readonly repoUrl?: string | undefined;
        readonly homepageUrl?: string | undefined;
        readonly imageUrl?: string | undefined;
    }> & import("effect/StandardSchema").StandardSchemaV1<{
        readonly accountId: string;
        readonly gatewayId: string;
        readonly claimedBy: string;
        readonly title?: string | undefined;
        readonly description?: string | undefined;
        readonly repoUrl?: string | undefined;
        readonly homepageUrl?: string | undefined;
        readonly imageUrl?: string | undefined;
    }, {
        readonly accountId: string;
        readonly gatewayId: string;
        readonly claimedBy: string;
        readonly title?: string | undefined;
        readonly description?: string | undefined;
        readonly repoUrl?: string | undefined;
        readonly homepageUrl?: string | undefined;
        readonly imageUrl?: string | undefined;
    }> & Schema.Struct<{
        readonly accountId: Schema.String;
        readonly gatewayId: Schema.String;
        readonly claimedBy: Schema.String;
        readonly title: Schema.optional<Schema.String>;
        readonly description: Schema.optional<Schema.String>;
        readonly repoUrl: Schema.optional<Schema.String>;
        readonly homepageUrl: Schema.optional<Schema.String>;
        readonly imageUrl: Schema.optional<Schema.String>;
    }>, import("effect/StandardSchema").StandardJSONSchemaV1<{
        readonly data: {
            readonly contractId: string;
            readonly methodName: "__fastdata_kv";
            readonly key: string;
            readonly manifest: {
                readonly claimedBy: string | null;
                readonly title: string | null;
                readonly description: string | null;
                readonly repoUrl: string | null;
                readonly homepageUrl: string | null;
                readonly imageUrl: string | null;
                readonly updatedAt: string | null;
            };
            readonly args: {
                readonly [x: string]: string;
            };
            readonly gas: string;
            readonly attachedDeposit: string;
        };
    }, {
        readonly data: {
            readonly contractId: string;
            readonly methodName: "__fastdata_kv";
            readonly key: string;
            readonly manifest: {
                readonly claimedBy: string | null;
                readonly title: string | null;
                readonly description: string | null;
                readonly repoUrl: string | null;
                readonly homepageUrl: string | null;
                readonly imageUrl: string | null;
                readonly updatedAt: string | null;
            };
            readonly args: {
                readonly [x: string]: string;
            };
            readonly gas: string;
            readonly attachedDeposit: string;
        };
    }> & import("effect/StandardSchema").StandardSchemaV1<{
        readonly data: {
            readonly contractId: string;
            readonly methodName: "__fastdata_kv";
            readonly key: string;
            readonly manifest: {
                readonly claimedBy: string | null;
                readonly title: string | null;
                readonly description: string | null;
                readonly repoUrl: string | null;
                readonly homepageUrl: string | null;
                readonly imageUrl: string | null;
                readonly updatedAt: string | null;
            };
            readonly args: {
                readonly [x: string]: string;
            };
            readonly gas: string;
            readonly attachedDeposit: string;
        };
    }, {
        readonly data: {
            readonly contractId: string;
            readonly methodName: "__fastdata_kv";
            readonly key: string;
            readonly manifest: {
                readonly claimedBy: string | null;
                readonly title: string | null;
                readonly description: string | null;
                readonly repoUrl: string | null;
                readonly homepageUrl: string | null;
                readonly imageUrl: string | null;
                readonly updatedAt: string | null;
            };
            readonly args: {
                readonly [x: string]: string;
            };
            readonly gas: string;
            readonly attachedDeposit: string;
        };
    }> & Schema.Struct<{
        readonly data: Schema.Struct<{
            readonly contractId: Schema.String;
            readonly methodName: Schema.Literal<"__fastdata_kv">;
            readonly key: Schema.String;
            readonly manifest: Schema.Struct<{
                readonly claimedBy: Schema.NullOr<Schema.String>;
                readonly title: Schema.NullOr<Schema.String>;
                readonly description: Schema.NullOr<Schema.String>;
                readonly repoUrl: Schema.NullOr<Schema.String>;
                readonly homepageUrl: Schema.NullOr<Schema.String>;
                readonly imageUrl: Schema.NullOr<Schema.String>;
                readonly updatedAt: Schema.NullOr<Schema.String>;
            }>;
            readonly args: Schema.$Record<Schema.String, Schema.String>;
            readonly gas: Schema.String;
            readonly attachedDeposit: Schema.String;
        }>;
    }>, {
        BAD_REQUEST: {
            readonly status: 400;
            readonly data: import("zod").ZodObject<{
                invalidFields: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString>>;
                validationErrors: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodObject<{
                    field: import("zod").ZodString;
                    message: import("zod").ZodString;
                    code: import("zod").ZodOptional<import("zod").ZodString>;
                }, import("zod/v4/core").$strip>>>;
            }, import("zod/v4/core").$strip>;
        };
    }>;
    prepareRegistryConfigWrite: import("@orpc/contract").ProcedureContract<import("effect/StandardSchema").StandardJSONSchemaV1<{
        readonly accountId: string;
        readonly gatewayId: string;
        readonly config: {
            readonly [x: string]: unknown;
        };
    }, {
        readonly accountId: string;
        readonly gatewayId: string;
        readonly config: {
            readonly [x: string]: unknown;
        };
    }> & import("effect/StandardSchema").StandardSchemaV1<{
        readonly accountId: string;
        readonly gatewayId: string;
        readonly config: {
            readonly [x: string]: unknown;
        };
    }, {
        readonly accountId: string;
        readonly gatewayId: string;
        readonly config: {
            readonly [x: string]: unknown;
        };
    }> & Schema.Struct<{
        readonly accountId: Schema.String;
        readonly gatewayId: Schema.String;
        readonly config: Schema.$Record<Schema.String, Schema.Unknown>;
    }>, import("effect/StandardSchema").StandardJSONSchemaV1<{
        readonly data: {
            readonly contractId: string;
            readonly methodName: "__fastdata_kv";
            readonly key: string;
            readonly args: {
                readonly [x: string]: string;
            };
            readonly gas: string;
            readonly attachedDeposit: string;
        };
    }, {
        readonly data: {
            readonly contractId: string;
            readonly methodName: "__fastdata_kv";
            readonly key: string;
            readonly args: {
                readonly [x: string]: string;
            };
            readonly gas: string;
            readonly attachedDeposit: string;
        };
    }> & import("effect/StandardSchema").StandardSchemaV1<{
        readonly data: {
            readonly contractId: string;
            readonly methodName: "__fastdata_kv";
            readonly key: string;
            readonly args: {
                readonly [x: string]: string;
            };
            readonly gas: string;
            readonly attachedDeposit: string;
        };
    }, {
        readonly data: {
            readonly contractId: string;
            readonly methodName: "__fastdata_kv";
            readonly key: string;
            readonly args: {
                readonly [x: string]: string;
            };
            readonly gas: string;
            readonly attachedDeposit: string;
        };
    }> & Schema.Struct<{
        readonly data: Schema.Struct<{
            readonly contractId: Schema.String;
            readonly methodName: Schema.Literal<"__fastdata_kv">;
            readonly key: Schema.String;
            readonly args: Schema.$Record<Schema.String, Schema.String>;
            readonly gas: Schema.String;
            readonly attachedDeposit: Schema.String;
        }>;
    }>, {
        BAD_REQUEST: {
            readonly status: 400;
            readonly data: import("zod").ZodObject<{
                invalidFields: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString>>;
                validationErrors: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodObject<{
                    field: import("zod").ZodString;
                    message: import("zod").ZodString;
                    code: import("zod").ZodOptional<import("zod").ZodString>;
                }, import("zod/v4/core").$strip>>>;
            }, import("zod/v4/core").$strip>;
        };
    }>;
    relayRegistryMetadataWrite: import("@orpc/contract").ProcedureContract<import("effect/StandardSchema").StandardJSONSchemaV1<{
        readonly payload: string;
    }, {
        readonly payload: string;
    }> & import("effect/StandardSchema").StandardSchemaV1<{
        readonly payload: string;
    }, {
        readonly payload: string;
    }> & Schema.Struct<{
        readonly payload: Schema.String;
    }>, import("effect/StandardSchema").StandardJSONSchemaV1<{
        readonly data: {
            readonly transactionHash: string | null;
            readonly relayerAccountId: string;
            readonly senderId: string;
        };
    }, {
        readonly data: {
            readonly transactionHash: string | null;
            readonly relayerAccountId: string;
            readonly senderId: string;
        };
    }> & import("effect/StandardSchema").StandardSchemaV1<{
        readonly data: {
            readonly transactionHash: string | null;
            readonly relayerAccountId: string;
            readonly senderId: string;
        };
    }, {
        readonly data: {
            readonly transactionHash: string | null;
            readonly relayerAccountId: string;
            readonly senderId: string;
        };
    }> & Schema.Struct<{
        readonly data: Schema.Struct<{
            readonly transactionHash: Schema.NullOr<Schema.String>;
            readonly relayerAccountId: Schema.String;
            readonly senderId: Schema.String;
        }>;
    }>, {
        BAD_REQUEST: {
            readonly status: 400;
            readonly data: import("zod").ZodObject<{
                invalidFields: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString>>;
                validationErrors: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodObject<{
                    field: import("zod").ZodString;
                    message: import("zod").ZodString;
                    code: import("zod").ZodOptional<import("zod").ZodString>;
                }, import("zod/v4/core").$strip>>>;
            }, import("zod/v4/core").$strip>;
        };
        FORBIDDEN: {
            readonly status: 403;
            readonly data: import("zod").ZodObject<{
                requiredPermissions: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString>>;
                action: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
        };
        UNAUTHORIZED: {
            readonly status: 401;
            readonly data: import("zod").ZodObject<{
                apiKeyProvided: import("zod").ZodBoolean;
                provider: import("zod").ZodOptional<import("zod").ZodString>;
                authType: import("zod").ZodOptional<import("zod").ZodEnum<{
                    apiKey: "apiKey";
                    oauth: "oauth";
                    token: "token";
                }>>;
            }, import("zod/v4/core").$strip>;
        };
    }>;
    kvGet: import("@orpc/contract").ProcedureContract<import("effect/StandardSchema").StandardJSONSchemaV1<{
        readonly path: string;
    }, {
        readonly path: string;
    }> & import("effect/StandardSchema").StandardSchemaV1<{
        readonly path: string;
    }, {
        readonly path: string;
    }> & Schema.Struct<{
        readonly path: Schema.String;
    }>, import("effect/StandardSchema").StandardJSONSchemaV1<{
        readonly data: unknown;
    }, {
        readonly data: unknown;
    }> & import("effect/StandardSchema").StandardSchemaV1<{
        readonly data: unknown;
    }, {
        readonly data: unknown;
    }> & Schema.Struct<{
        readonly data: Schema.NullOr<Schema.Unknown>;
    }>, {
        NOT_FOUND: {
            readonly status: 404;
            readonly data: import("zod").ZodObject<{
                resource: import("zod").ZodOptional<import("zod").ZodString>;
                resourceId: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
        };
    }>;
    kvList: import("@orpc/contract").ProcedureContract<import("effect/StandardSchema").StandardJSONSchemaV1<{
        readonly prefix: string;
        readonly limit?: number | undefined;
        readonly cursor?: string | undefined;
    }, {
        readonly prefix: string;
        readonly limit?: number | undefined;
        readonly cursor?: string | undefined;
    }> & import("effect/StandardSchema").StandardSchemaV1<{
        readonly prefix: string;
        readonly limit?: number | undefined;
        readonly cursor?: string | undefined;
    }, {
        readonly prefix: string;
        readonly limit?: number | undefined;
        readonly cursor?: string | undefined;
    }> & Schema.Struct<{
        readonly prefix: Schema.String;
        readonly limit: Schema.optional<Schema.Int>;
        readonly cursor: Schema.optional<Schema.String>;
    }>, import("effect/StandardSchema").StandardJSONSchemaV1<{
        readonly data: readonly {
            readonly key: string;
            readonly value: unknown;
            readonly blockHeight?: number | undefined;
            readonly blockTimestamp?: number | undefined;
            readonly txHash?: string | undefined;
            readonly signerId?: string | undefined;
        }[];
        readonly meta: {
            readonly total: number;
            readonly hasMore: boolean;
            readonly nextCursor: string | null;
        };
    }, {
        readonly data: readonly {
            readonly key: string;
            readonly value: unknown;
            readonly blockHeight?: number | undefined;
            readonly blockTimestamp?: number | undefined;
            readonly txHash?: string | undefined;
            readonly signerId?: string | undefined;
        }[];
        readonly meta: {
            readonly total: number;
            readonly hasMore: boolean;
            readonly nextCursor: string | null;
        };
    }> & import("effect/StandardSchema").StandardSchemaV1<{
        readonly data: readonly {
            readonly key: string;
            readonly value: unknown;
            readonly blockHeight?: number | undefined;
            readonly blockTimestamp?: number | undefined;
            readonly txHash?: string | undefined;
            readonly signerId?: string | undefined;
        }[];
        readonly meta: {
            readonly total: number;
            readonly hasMore: boolean;
            readonly nextCursor: string | null;
        };
    }, {
        readonly data: readonly {
            readonly key: string;
            readonly value: unknown;
            readonly blockHeight?: number | undefined;
            readonly blockTimestamp?: number | undefined;
            readonly txHash?: string | undefined;
            readonly signerId?: string | undefined;
        }[];
        readonly meta: {
            readonly total: number;
            readonly hasMore: boolean;
            readonly nextCursor: string | null;
        };
    }> & Schema.Struct<{
        readonly data: Schema.$Array<Schema.Struct<{
            readonly key: Schema.String;
            readonly value: Schema.Unknown;
            readonly blockHeight: Schema.optional<Schema.Number>;
            readonly blockTimestamp: Schema.optional<Schema.Number>;
            readonly txHash: Schema.optional<Schema.String>;
            readonly signerId: Schema.optional<Schema.String>;
        }>>;
        readonly meta: Schema.Struct<{
            readonly total: Schema.Natural;
            readonly hasMore: Schema.Boolean;
            readonly nextCursor: Schema.NullOr<Schema.String>;
        }>;
    }>, {
        BAD_REQUEST: {
            readonly status: 400;
            readonly data: import("zod").ZodObject<{
                invalidFields: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString>>;
                validationErrors: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodObject<{
                    field: import("zod").ZodString;
                    message: import("zod").ZodString;
                    code: import("zod").ZodOptional<import("zod").ZodString>;
                }, import("zod/v4/core").$strip>>>;
            }, import("zod/v4/core").$strip>;
        };
    }>;
    kvPrepareWrite: import("@orpc/contract").ProcedureContract<import("effect/StandardSchema").StandardJSONSchemaV1<{
        readonly entries: {
            readonly path: string;
            readonly value: unknown;
        }[];
    }, {
        readonly entries: {
            readonly path: string;
            readonly value: unknown;
        }[];
    }> & import("effect/StandardSchema").StandardSchemaV1<{
        readonly entries: {
            readonly path: string;
            readonly value: unknown;
        }[];
    }, {
        readonly entries: {
            readonly path: string;
            readonly value: unknown;
        }[];
    }> & Schema.Struct<{
        readonly entries: Schema.mutable<Schema.$Array<Schema.Struct<{
            readonly path: Schema.String;
            readonly value: Schema.Unknown;
        }>>>;
    }>, import("effect/StandardSchema").StandardJSONSchemaV1<{
        readonly data: {
            readonly contractId: string;
            readonly methodName: "__fastdata_kv";
            readonly args: {
                readonly [x: string]: string;
            };
            readonly gas: string;
            readonly attachedDeposit: string;
        };
    }, {
        readonly data: {
            readonly contractId: string;
            readonly methodName: "__fastdata_kv";
            readonly args: {
                readonly [x: string]: string;
            };
            readonly gas: string;
            readonly attachedDeposit: string;
        };
    }> & import("effect/StandardSchema").StandardSchemaV1<{
        readonly data: {
            readonly contractId: string;
            readonly methodName: "__fastdata_kv";
            readonly args: {
                readonly [x: string]: string;
            };
            readonly gas: string;
            readonly attachedDeposit: string;
        };
    }, {
        readonly data: {
            readonly contractId: string;
            readonly methodName: "__fastdata_kv";
            readonly args: {
                readonly [x: string]: string;
            };
            readonly gas: string;
            readonly attachedDeposit: string;
        };
    }> & Schema.Struct<{
        readonly data: Schema.Struct<{
            readonly contractId: Schema.String;
            readonly methodName: Schema.Literal<"__fastdata_kv">;
            readonly args: Schema.$Record<Schema.String, Schema.String>;
            readonly gas: Schema.String;
            readonly attachedDeposit: Schema.String;
        }>;
    }>, {
        BAD_REQUEST: {
            readonly status: 400;
            readonly data: import("zod").ZodObject<{
                invalidFields: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString>>;
                validationErrors: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodObject<{
                    field: import("zod").ZodString;
                    message: import("zod").ZodString;
                    code: import("zod").ZodOptional<import("zod").ZodString>;
                }, import("zod/v4/core").$strip>>>;
            }, import("zod/v4/core").$strip>;
        };
    }>;
    kvRelayWrite: import("@orpc/contract").ProcedureContract<import("effect/StandardSchema").StandardJSONSchemaV1<{
        readonly payload: string;
    }, {
        readonly payload: string;
    }> & import("effect/StandardSchema").StandardSchemaV1<{
        readonly payload: string;
    }, {
        readonly payload: string;
    }> & Schema.Struct<{
        readonly payload: Schema.String;
    }>, import("effect/StandardSchema").StandardJSONSchemaV1<{
        readonly data: {
            readonly transactionHash: string | null;
            readonly relayerAccountId: string;
            readonly senderId: string;
        };
    }, {
        readonly data: {
            readonly transactionHash: string | null;
            readonly relayerAccountId: string;
            readonly senderId: string;
        };
    }> & import("effect/StandardSchema").StandardSchemaV1<{
        readonly data: {
            readonly transactionHash: string | null;
            readonly relayerAccountId: string;
            readonly senderId: string;
        };
    }, {
        readonly data: {
            readonly transactionHash: string | null;
            readonly relayerAccountId: string;
            readonly senderId: string;
        };
    }> & Schema.Struct<{
        readonly data: Schema.Struct<{
            readonly transactionHash: Schema.NullOr<Schema.String>;
            readonly relayerAccountId: Schema.String;
            readonly senderId: Schema.String;
        }>;
    }>, {
        BAD_REQUEST: {
            readonly status: 400;
            readonly data: import("zod").ZodObject<{
                invalidFields: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString>>;
                validationErrors: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodObject<{
                    field: import("zod").ZodString;
                    message: import("zod").ZodString;
                    code: import("zod").ZodOptional<import("zod").ZodString>;
                }, import("zod/v4/core").$strip>>>;
            }, import("zod/v4/core").$strip>;
        };
        FORBIDDEN: {
            readonly status: 403;
            readonly data: import("zod").ZodObject<{
                requiredPermissions: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString>>;
                action: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
        };
        UNAUTHORIZED: {
            readonly status: 401;
            readonly data: import("zod").ZodObject<{
                apiKeyProvided: import("zod").ZodBoolean;
                provider: import("zod").ZodOptional<import("zod").ZodString>;
                authType: import("zod").ZodOptional<import("zod").ZodEnum<{
                    apiKey: "apiKey";
                    oauth: "oauth";
                    token: "token";
                }>>;
            }, import("zod/v4/core").$strip>;
        };
    }>;
};
export type ContractType = typeof contract;
