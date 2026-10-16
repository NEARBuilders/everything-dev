import "@orpc/openapi/extensions/route";
import { z } from "zod";
export declare const contract: {
    agentCreate: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        name: z.ZodString;
        policy: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    }, z.core.$strip>, z.ZodObject<{
        correlation_id: z.ZodString;
        type: z.ZodString;
        status: z.ZodString;
        expires_at: z.ZodString;
        intent: z.ZodObject<{
            standard: z.ZodString;
            payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        }, z.core.$loose>;
        preview: z.ZodOptional<z.ZodUnknown>;
    }, z.core.$loose>, {
        UNAUTHORIZED: {
            message: string;
        };
        BAD_REQUEST: {
            message: string;
        };
        SERVICE_UNAVAILABLE: {
            message: string;
        };
        TOO_MANY_REQUESTS: {
            message: string;
        };
        BAD_GATEWAY: {
            message: string;
        };
        INTERNAL_SERVER_ERROR: {
            message: string;
        };
    }>;
    agentList: import("@orpc/contract").ProcedureContract<import("@orpc/contract").InitialInputSchema, z.ZodObject<{
        data: z.ZodArray<z.ZodUnknown>;
        next_cursor: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$loose>, {
        UNAUTHORIZED: {
            message: string;
        };
        BAD_REQUEST: {
            message: string;
        };
        CONFLICT: {
            message: string;
        };
        TOO_MANY_REQUESTS: {
            message: string;
        };
        SERVICE_UNAVAILABLE: {
            message: string;
        };
        BAD_GATEWAY: {
            message: string;
        };
        INTERNAL_SERVER_ERROR: {
            message: string;
        };
    }>;
    agentGet: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        agentId: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        id: z.ZodString;
    }, z.core.$loose>, {
        UNAUTHORIZED: {
            message: string;
        };
        BAD_REQUEST: {
            message: string;
        };
        CONFLICT: {
            message: string;
        };
        TOO_MANY_REQUESTS: {
            message: string;
        };
        NOT_FOUND: {
            message: string;
        };
        SERVICE_UNAVAILABLE: {
            message: string;
        };
        BAD_GATEWAY: {
            message: string;
        };
        INTERNAL_SERVER_ERROR: {
            message: string;
        };
    }>;
    prepareIntent: import("@orpc/contract").ProcedureContract<z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"agent_create">;
        name: z.ZodString;
        policy: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"grant_issue">;
        agentId: z.ZodString;
        label: z.ZodString;
        expiresAt: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"grant_revoke">;
        agentId: z.ZodString;
        grantId: z.ZodString;
    }, z.core.$strip>], "type">, z.ZodObject<{
        correlation_id: z.ZodString;
        type: z.ZodString;
        status: z.ZodString;
        expires_at: z.ZodString;
        intent: z.ZodObject<{
            standard: z.ZodString;
            payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        }, z.core.$loose>;
        preview: z.ZodOptional<z.ZodUnknown>;
    }, z.core.$loose>, {
        UNAUTHORIZED: {
            message: string;
        };
        NOT_FOUND: {
            message: string;
        };
        BAD_REQUEST: {
            message: string;
        };
        SERVICE_UNAVAILABLE: {
            message: string;
        };
        TOO_MANY_REQUESTS: {
            message: string;
        };
        BAD_GATEWAY: {
            message: string;
        };
        INTERNAL_SERVER_ERROR: {
            message: string;
        };
    }>;
    intentSubmit: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        type: z.ZodEnum<{
            agent_create: "agent_create";
            grant_issue: "grant_issue";
            grant_revoke: "grant_revoke";
        }>;
        correlationId: z.ZodString;
        signedData: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    }, z.core.$strip>, z.ZodObject<{
        correlation_id: z.ZodString;
        status: z.ZodString;
        type: z.ZodOptional<z.ZodString>;
        details: z.ZodOptional<z.ZodUnknown>;
    }, z.core.$loose>, {
        UNAUTHORIZED: {
            message: string;
        };
        NOT_FOUND: {
            message: string;
        };
        BAD_REQUEST: {
            message: string;
        };
        SERVICE_UNAVAILABLE: {
            message: string;
        };
        TOO_MANY_REQUESTS: {
            message: string;
        };
        BAD_GATEWAY: {
            message: string;
        };
        INTERNAL_SERVER_ERROR: {
            message: string;
        };
    }>;
    intentStatus: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        correlationId: z.ZodString;
        waitMs: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>, z.ZodObject<{
        correlation_id: z.ZodString;
        status: z.ZodString;
        type: z.ZodOptional<z.ZodString>;
        details: z.ZodOptional<z.ZodUnknown>;
    }, z.core.$loose>, {
        UNAUTHORIZED: {
            message: string;
        };
        NOT_FOUND: {
            message: string;
        };
        SERVICE_UNAVAILABLE: {
            message: string;
        };
        TOO_MANY_REQUESTS: {
            message: string;
        };
        BAD_GATEWAY: {
            message: string;
        };
        INTERNAL_SERVER_ERROR: {
            message: string;
        };
    }>;
    grantList: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        agentId: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        data: z.ZodArray<z.ZodUnknown>;
    }, z.core.$strip>, {
        UNAUTHORIZED: {
            message: string;
        };
        BAD_REQUEST: {
            message: string;
        };
        CONFLICT: {
            message: string;
        };
        TOO_MANY_REQUESTS: {
            message: string;
        };
        NOT_FOUND: {
            message: string;
        };
        SERVICE_UNAVAILABLE: {
            message: string;
        };
        BAD_GATEWAY: {
            message: string;
        };
        INTERNAL_SERVER_ERROR: {
            message: string;
        };
    }>;
};
export type ContractType = typeof contract;
