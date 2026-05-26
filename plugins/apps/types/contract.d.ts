import { z } from "every-plugin/zod";
export declare const contract: {
    listRegistryApps: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        q: z.ZodOptional<z.ZodString>;
        parent: z.ZodOptional<z.ZodString>;
        root: z.ZodOptional<z.ZodString>;
        ancestor: z.ZodOptional<z.ZodString>;
        limit: z.ZodOptional<z.ZodNumber>;
        cursor: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        data: z.ZodArray<z.ZodObject<{
            accountId: z.ZodString;
            gatewayId: z.ZodString;
            canonicalKey: z.ZodString;
            canonicalConfigUrl: z.ZodString;
            startCommand: z.ZodString;
            domain: z.ZodNullable<z.ZodString>;
            openUrl: z.ZodNullable<z.ZodString>;
            hostUrl: z.ZodNullable<z.ZodString>;
            uiUrl: z.ZodNullable<z.ZodString>;
            uiSsrUrl: z.ZodNullable<z.ZodString>;
            apiUrl: z.ZodNullable<z.ZodString>;
            extends: z.ZodNullable<z.ZodString>;
            parent: z.ZodNullable<z.ZodString>;
            root: z.ZodNullable<z.ZodString>;
            depth: z.ZodNumber;
            status: z.ZodEnum<{
                ready: "ready";
                invalid: "invalid";
            }>;
            metadata: z.ZodNullable<z.ZodObject<{
                claimedBy: z.ZodNullable<z.ZodString>;
                title: z.ZodNullable<z.ZodString>;
                description: z.ZodNullable<z.ZodString>;
                repoUrl: z.ZodNullable<z.ZodString>;
                homepageUrl: z.ZodNullable<z.ZodString>;
                imageUrl: z.ZodNullable<z.ZodString>;
                updatedAt: z.ZodNullable<z.ZodISODateTime>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        meta: z.ZodObject<{
            total: z.ZodNumber;
            hasMore: z.ZodBoolean;
            nextCursor: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        BAD_REQUEST: {
            readonly status: 400;
            readonly data: z.ZodObject<{
                invalidFields: z.ZodOptional<z.ZodArray<z.ZodString>>;
                validationErrors: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    field: z.ZodString;
                    message: z.ZodString;
                    code: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>>>;
            }, z.core.$strip>;
        };
    }>>, Record<never, never>>;
    getRegistryAppsByAccount: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        accountId: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        data: z.ZodArray<z.ZodObject<{
            accountId: z.ZodString;
            gatewayId: z.ZodString;
            canonicalKey: z.ZodString;
            canonicalConfigUrl: z.ZodString;
            startCommand: z.ZodString;
            domain: z.ZodNullable<z.ZodString>;
            openUrl: z.ZodNullable<z.ZodString>;
            hostUrl: z.ZodNullable<z.ZodString>;
            uiUrl: z.ZodNullable<z.ZodString>;
            uiSsrUrl: z.ZodNullable<z.ZodString>;
            apiUrl: z.ZodNullable<z.ZodString>;
            extends: z.ZodNullable<z.ZodString>;
            parent: z.ZodNullable<z.ZodString>;
            root: z.ZodNullable<z.ZodString>;
            depth: z.ZodNumber;
            status: z.ZodEnum<{
                ready: "ready";
                invalid: "invalid";
            }>;
            metadata: z.ZodNullable<z.ZodObject<{
                claimedBy: z.ZodNullable<z.ZodString>;
                title: z.ZodNullable<z.ZodString>;
                description: z.ZodNullable<z.ZodString>;
                repoUrl: z.ZodNullable<z.ZodString>;
                homepageUrl: z.ZodNullable<z.ZodString>;
                imageUrl: z.ZodNullable<z.ZodString>;
                updatedAt: z.ZodNullable<z.ZodISODateTime>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        meta: z.ZodObject<{
            total: z.ZodNumber;
            hasMore: z.ZodBoolean;
            nextCursor: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        NOT_FOUND: {
            readonly status: 404;
            readonly data: z.ZodObject<{
                resource: z.ZodOptional<z.ZodString>;
                resourceId: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        };
    }>>, Record<never, never>>;
    getRegistryApp: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        accountId: z.ZodString;
        gatewayId: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        data: z.ZodObject<{
            accountId: z.ZodString;
            gatewayId: z.ZodString;
            canonicalKey: z.ZodString;
            canonicalConfigUrl: z.ZodString;
            startCommand: z.ZodString;
            domain: z.ZodNullable<z.ZodString>;
            openUrl: z.ZodNullable<z.ZodString>;
            hostUrl: z.ZodNullable<z.ZodString>;
            uiUrl: z.ZodNullable<z.ZodString>;
            uiSsrUrl: z.ZodNullable<z.ZodString>;
            apiUrl: z.ZodNullable<z.ZodString>;
            extends: z.ZodNullable<z.ZodString>;
            parent: z.ZodNullable<z.ZodString>;
            root: z.ZodNullable<z.ZodString>;
            depth: z.ZodNumber;
            status: z.ZodEnum<{
                ready: "ready";
                invalid: "invalid";
            }>;
            metadata: z.ZodNullable<z.ZodObject<{
                claimedBy: z.ZodNullable<z.ZodString>;
                title: z.ZodNullable<z.ZodString>;
                description: z.ZodNullable<z.ZodString>;
                repoUrl: z.ZodNullable<z.ZodString>;
                homepageUrl: z.ZodNullable<z.ZodString>;
                imageUrl: z.ZodNullable<z.ZodString>;
                updatedAt: z.ZodNullable<z.ZodISODateTime>;
            }, z.core.$strip>>;
            metadataKey: z.ZodString;
            metadataContractId: z.ZodString;
            metadataFastKvUrl: z.ZodString;
            extendsChain: z.ZodArray<z.ZodString>;
            resolvedConfig: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        }, z.core.$strip>;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        NOT_FOUND: {
            readonly status: 404;
            readonly data: z.ZodObject<{
                resource: z.ZodOptional<z.ZodString>;
                resourceId: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        };
    }>>, Record<never, never>>;
    getRegistryAppByHost: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        hostUrl: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        data: z.ZodObject<{
            accountId: z.ZodString;
            gatewayId: z.ZodString;
            canonicalKey: z.ZodString;
            canonicalConfigUrl: z.ZodString;
            startCommand: z.ZodString;
            domain: z.ZodNullable<z.ZodString>;
            openUrl: z.ZodNullable<z.ZodString>;
            hostUrl: z.ZodNullable<z.ZodString>;
            uiUrl: z.ZodNullable<z.ZodString>;
            uiSsrUrl: z.ZodNullable<z.ZodString>;
            apiUrl: z.ZodNullable<z.ZodString>;
            extends: z.ZodNullable<z.ZodString>;
            parent: z.ZodNullable<z.ZodString>;
            root: z.ZodNullable<z.ZodString>;
            depth: z.ZodNumber;
            status: z.ZodEnum<{
                ready: "ready";
                invalid: "invalid";
            }>;
            metadata: z.ZodNullable<z.ZodObject<{
                claimedBy: z.ZodNullable<z.ZodString>;
                title: z.ZodNullable<z.ZodString>;
                description: z.ZodNullable<z.ZodString>;
                repoUrl: z.ZodNullable<z.ZodString>;
                homepageUrl: z.ZodNullable<z.ZodString>;
                imageUrl: z.ZodNullable<z.ZodString>;
                updatedAt: z.ZodNullable<z.ZodISODateTime>;
            }, z.core.$strip>>;
            metadataKey: z.ZodString;
            metadataContractId: z.ZodString;
            metadataFastKvUrl: z.ZodString;
            extendsChain: z.ZodArray<z.ZodString>;
            resolvedConfig: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        }, z.core.$strip>;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        NOT_FOUND: {
            readonly status: 404;
            readonly data: z.ZodObject<{
                resource: z.ZodOptional<z.ZodString>;
                resourceId: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        };
    }>>, Record<never, never>>;
    getRegistryStatus: import("@orpc/contract").ContractProcedure<import("@orpc/contract").Schema<unknown, unknown>, z.ZodObject<{
        discoveredApps: z.ZodNumber;
        metadataContractId: z.ZodString;
        metadataFastKvUrl: z.ZodString;
        relayEnabled: z.ZodBoolean;
        relayAccountId: z.ZodNullable<z.ZodString>;
        timestamp: z.ZodISODateTime;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, Record<never, never>>, Record<never, never>>;
    prepareRegistryMetadataWrite: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        accountId: z.ZodString;
        gatewayId: z.ZodString;
        claimedBy: z.ZodString;
        title: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
        repoUrl: z.ZodOptional<z.ZodString>;
        homepageUrl: z.ZodOptional<z.ZodString>;
        imageUrl: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        data: z.ZodObject<{
            contractId: z.ZodString;
            methodName: z.ZodLiteral<"__fastdata_kv">;
            key: z.ZodString;
            manifest: z.ZodObject<{
                claimedBy: z.ZodNullable<z.ZodString>;
                title: z.ZodNullable<z.ZodString>;
                description: z.ZodNullable<z.ZodString>;
                repoUrl: z.ZodNullable<z.ZodString>;
                homepageUrl: z.ZodNullable<z.ZodString>;
                imageUrl: z.ZodNullable<z.ZodString>;
                updatedAt: z.ZodNullable<z.ZodISODateTime>;
            }, z.core.$strip>;
            args: z.ZodRecord<z.ZodString, z.ZodString>;
            gas: z.ZodString;
            attachedDeposit: z.ZodString;
        }, z.core.$strip>;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        BAD_REQUEST: {
            readonly status: 400;
            readonly data: z.ZodObject<{
                invalidFields: z.ZodOptional<z.ZodArray<z.ZodString>>;
                validationErrors: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    field: z.ZodString;
                    message: z.ZodString;
                    code: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>>>;
            }, z.core.$strip>;
        };
    }>>, Record<never, never>>;
    relayRegistryMetadataWrite: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        payload: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        data: z.ZodObject<{
            transactionHash: z.ZodNullable<z.ZodString>;
            relayerAccountId: z.ZodString;
            senderId: z.ZodString;
        }, z.core.$strip>;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        BAD_REQUEST: {
            readonly status: 400;
            readonly data: z.ZodObject<{
                invalidFields: z.ZodOptional<z.ZodArray<z.ZodString>>;
                validationErrors: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    field: z.ZodString;
                    message: z.ZodString;
                    code: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>>>;
            }, z.core.$strip>;
        };
        FORBIDDEN: {
            readonly status: 403;
            readonly data: z.ZodObject<{
                requiredPermissions: z.ZodOptional<z.ZodArray<z.ZodString>>;
                action: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        };
        UNAUTHORIZED: {
            readonly status: 401;
            readonly data: z.ZodObject<{
                apiKeyProvided: z.ZodBoolean;
                provider: z.ZodOptional<z.ZodString>;
                authType: z.ZodOptional<z.ZodEnum<{
                    apiKey: "apiKey";
                    oauth: "oauth";
                    token: "token";
                }>>;
            }, z.core.$strip>;
        };
    }>>, Record<never, never>>;
    kvGet: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        path: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        data: z.ZodNullable<z.ZodUnknown>;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        NOT_FOUND: {
            readonly status: 404;
            readonly data: z.ZodObject<{
                resource: z.ZodOptional<z.ZodString>;
                resourceId: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        };
    }>>, Record<never, never>>;
    kvList: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        prefix: z.ZodString;
        limit: z.ZodOptional<z.ZodNumber>;
        cursor: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        data: z.ZodArray<z.ZodObject<{
            key: z.ZodString;
            value: z.ZodUnknown;
            blockHeight: z.ZodOptional<z.ZodNumber>;
            blockTimestamp: z.ZodOptional<z.ZodNumber>;
            txHash: z.ZodOptional<z.ZodString>;
            signerId: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        meta: z.ZodObject<{
            total: z.ZodNumber;
            hasMore: z.ZodBoolean;
            nextCursor: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        BAD_REQUEST: {
            readonly status: 400;
            readonly data: z.ZodObject<{
                invalidFields: z.ZodOptional<z.ZodArray<z.ZodString>>;
                validationErrors: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    field: z.ZodString;
                    message: z.ZodString;
                    code: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>>>;
            }, z.core.$strip>;
        };
    }>>, Record<never, never>>;
    kvPrepareWrite: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        entries: z.ZodArray<z.ZodObject<{
            path: z.ZodString;
            value: z.ZodUnknown;
        }, z.core.$strip>>;
    }, z.core.$strip>, z.ZodObject<{
        data: z.ZodObject<{
            contractId: z.ZodString;
            methodName: z.ZodLiteral<"__fastdata_kv">;
            args: z.ZodRecord<z.ZodString, z.ZodString>;
            gas: z.ZodString;
            attachedDeposit: z.ZodString;
        }, z.core.$strip>;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        BAD_REQUEST: {
            readonly status: 400;
            readonly data: z.ZodObject<{
                invalidFields: z.ZodOptional<z.ZodArray<z.ZodString>>;
                validationErrors: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    field: z.ZodString;
                    message: z.ZodString;
                    code: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>>>;
            }, z.core.$strip>;
        };
    }>>, Record<never, never>>;
    kvRelayWrite: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        payload: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        data: z.ZodObject<{
            transactionHash: z.ZodNullable<z.ZodString>;
            relayerAccountId: z.ZodString;
            senderId: z.ZodString;
        }, z.core.$strip>;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        BAD_REQUEST: {
            readonly status: 400;
            readonly data: z.ZodObject<{
                invalidFields: z.ZodOptional<z.ZodArray<z.ZodString>>;
                validationErrors: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    field: z.ZodString;
                    message: z.ZodString;
                    code: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>>>;
            }, z.core.$strip>;
        };
        FORBIDDEN: {
            readonly status: 403;
            readonly data: z.ZodObject<{
                requiredPermissions: z.ZodOptional<z.ZodArray<z.ZodString>>;
                action: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        };
        UNAUTHORIZED: {
            readonly status: 401;
            readonly data: z.ZodObject<{
                apiKeyProvided: z.ZodBoolean;
                provider: z.ZodOptional<z.ZodString>;
                authType: z.ZodOptional<z.ZodEnum<{
                    apiKey: "apiKey";
                    oauth: "oauth";
                    token: "token";
                }>>;
            }, z.core.$strip>;
        };
    }>>, Record<never, never>>;
};
export type ContractType = typeof contract;
