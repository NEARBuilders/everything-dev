import { z } from "every-plugin/zod";
export declare const ItemSchema: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    createdAt: z.ZodString;
}, z.core.$strip>;
export declare const SearchResultSchema: z.ZodObject<{
    item: z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
        createdAt: z.ZodString;
    }, z.core.$strip>;
    score: z.ZodNumber;
}, z.core.$strip>;
export declare const BackgroundEventSchema: z.ZodObject<{
    id: z.ZodString;
    index: z.ZodNumber;
    timestamp: z.ZodNumber;
}, z.core.$strip>;
export declare const ThingSchema: z.ZodObject<{
    thingId: z.ZodString;
    type: z.ZodString;
    payload: z.ZodUnknown;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, z.core.$strip>;
export declare const CreatedThingSchema: z.ZodObject<{
    thingId: z.ZodString;
    type: z.ZodString;
    payload: z.ZodUnknown;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
    action: z.ZodString;
}, z.core.$strip>;
export declare const ListThingsSchema: z.ZodObject<{
    data: z.ZodArray<z.ZodObject<{
        thingId: z.ZodString;
        type: z.ZodString;
        payload: z.ZodUnknown;
        createdAt: z.ZodString;
        updatedAt: z.ZodString;
    }, z.core.$strip>>;
    meta: z.ZodObject<{
        total: z.ZodNumber;
        hasMore: z.ZodBoolean;
        nextCursor: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const contract: {
    getById: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        id: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        item: z.ZodObject<{
            id: z.ZodString;
            title: z.ZodString;
            createdAt: z.ZodString;
        }, z.core.$strip>;
        userId: z.ZodString;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        CONFLICT: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    search: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        query: z.ZodString;
        limit: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>, import("@orpc/contract").Schema<AsyncIteratorObject<{
        item: {
            id: string;
            title: string;
            createdAt: string;
        };
        score: number;
    }, unknown, void>, import("@orpc/shared").AsyncIteratorClass<{
        item: {
            id: string;
            title: string;
            createdAt: string;
        };
        score: number;
    }, unknown, void>>, import("@orpc/contract").MergedErrorMap<Record<never, never>, Record<never, never>>, Record<never, never>>;
    ping: import("@orpc/contract").ContractProcedure<import("@orpc/contract").Schema<unknown, unknown>, z.ZodObject<{
        status: z.ZodLiteral<"ok">;
        timestamp: z.ZodString;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, Record<never, never>>, Record<never, never>>;
    listenBackground: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        maxResults: z.ZodOptional<z.ZodNumber>;
        lastEventId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, import("@orpc/contract").Schema<AsyncIteratorObject<{
        id: string;
        index: number;
        timestamp: number;
    }, unknown, void>, import("@orpc/shared").AsyncIteratorClass<{
        id: string;
        index: number;
        timestamp: number;
    }, unknown, void>>, import("@orpc/contract").MergedErrorMap<Record<never, never>, Record<never, never>>, Record<never, never>>;
    enqueueBackground: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        id: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        ok: z.ZodBoolean;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, Record<never, never>>, Record<never, never>>;
    createThing: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        thingId: z.ZodString;
        payload: z.ZodUnknown;
    }, z.core.$strip>, z.ZodObject<{
        thingId: z.ZodString;
        type: z.ZodString;
        payload: z.ZodUnknown;
        createdAt: z.ZodString;
        updatedAt: z.ZodString;
        action: z.ZodString;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        CONFLICT: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    getThing: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        thingId: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        thingId: z.ZodString;
        type: z.ZodString;
        payload: z.ZodUnknown;
        createdAt: z.ZodString;
        updatedAt: z.ZodString;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        NOT_FOUND: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    listThings: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        type: z.ZodOptional<z.ZodString>;
        limit: z.ZodDefault<z.ZodNumber>;
        cursor: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        data: z.ZodArray<z.ZodObject<{
            thingId: z.ZodString;
            type: z.ZodString;
            payload: z.ZodUnknown;
            createdAt: z.ZodString;
            updatedAt: z.ZodString;
        }, z.core.$strip>>;
        meta: z.ZodObject<{
            total: z.ZodNumber;
            hasMore: z.ZodBoolean;
            nextCursor: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, Record<never, never>>, Record<never, never>>;
    deleteThing: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        thingId: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        success: z.ZodLiteral<true>;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        NOT_FOUND: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
    testError: import("@orpc/contract").ContractProcedure<z.ZodObject<{
        kind: z.ZodEnum<{
            unauthorized: "unauthorized";
            forbidden: "forbidden";
            not_found: "not_found";
            conflict: "conflict";
            bad_request: "bad_request";
            internal: "internal";
        }>;
    }, z.core.$strip>, z.ZodObject<{
        ok: z.ZodLiteral<true>;
    }, z.core.$strip>, import("@orpc/contract").MergedErrorMap<Record<never, never>, import("@orpc/contract").MergedErrorMap<Record<never, never>, {
        UNAUTHORIZED: {
            status: number;
            message: string;
        };
        FORBIDDEN: {
            status: number;
            message: string;
        };
        NOT_FOUND: {
            status: number;
            message: string;
        };
        CONFLICT: {
            status: number;
            message: string;
        };
        BAD_REQUEST: {
            status: number;
            message: string;
        };
    }>>, Record<never, never>>;
};
export type ContractType = typeof contract;
