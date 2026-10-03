import "@orpc/openapi/extensions/route";
import { z } from "zod";
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
export declare const ThingEventSchema: z.ZodObject<{
    thingId: z.ZodString;
    type: z.ZodString;
    action: z.ZodString;
    timestamp: z.ZodString;
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
    getById: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        id: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        item: z.ZodObject<{
            id: z.ZodString;
            title: z.ZodString;
            createdAt: z.ZodString;
        }, z.core.$strip>;
        userId: z.ZodString;
    }, z.core.$strip>, {
        UNAUTHORIZED: {
            message: string;
        };
        FORBIDDEN: {
            message: string;
        };
        NOT_FOUND: {
            message: string;
        };
        CONFLICT: {
            message: string;
        };
        BAD_REQUEST: {
            message: string;
        };
    }>;
    search: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        query: z.ZodString;
        limit: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>, import("@orpc/contract").Schema<AsyncIteratorObject<{
        item: {
            id: string;
            title: string;
            createdAt: string;
        };
        score: number;
    }, unknown, void>, import("@standard-server/shared").AsyncIteratorClass<{
        item: {
            id: string;
            title: string;
            createdAt: string;
        };
        score: number;
    }, unknown, void>>, object>;
    ping: import("@orpc/contract").ProcedureContract<import("@orpc/contract").InitialInputSchema, z.ZodObject<{
        status: z.ZodLiteral<"ok">;
        timestamp: z.ZodString;
    }, z.core.$strip>, object>;
    listenBackground: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        maxResults: z.ZodOptional<z.ZodNumber>;
        lastEventId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, import("@orpc/contract").Schema<AsyncIteratorObject<{
        id: string;
        index: number;
        timestamp: number;
    }, unknown, void>, import("@standard-server/shared").AsyncIteratorClass<{
        id: string;
        index: number;
        timestamp: number;
    }, unknown, void>>, object>;
    enqueueBackground: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        id: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        ok: z.ZodBoolean;
    }, z.core.$strip>, object>;
    createThing: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        thingId: z.ZodString;
        payload: z.ZodUnknown;
    }, z.core.$strip>, z.ZodObject<{
        thingId: z.ZodString;
        type: z.ZodString;
        payload: z.ZodUnknown;
        createdAt: z.ZodString;
        updatedAt: z.ZodString;
        action: z.ZodString;
    }, z.core.$strip>, {
        CONFLICT: {
            message: string;
        };
        UNAUTHORIZED: {
            message: string;
        };
    }>;
    getThing: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        thingId: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        thingId: z.ZodString;
        type: z.ZodString;
        payload: z.ZodUnknown;
        createdAt: z.ZodString;
        updatedAt: z.ZodString;
    }, z.core.$strip>, {
        NOT_FOUND: {
            status: number;
            message: string;
        };
    }>;
    listThings: import("@orpc/contract").ProcedureContract<z.ZodObject<{
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
    }, z.core.$strip>, object>;
    subscribeThings: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        thingId: z.ZodOptional<z.ZodString>;
        type: z.ZodOptional<z.ZodString>;
        action: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, import("@orpc/contract").Schema<AsyncIteratorObject<{
        thingId: string;
        type: string;
        action: string;
        timestamp: string;
    }, unknown, void>, import("@standard-server/shared").AsyncIteratorClass<{
        thingId: string;
        type: string;
        action: string;
        timestamp: string;
    }, unknown, void>>, object>;
    deleteThing: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        thingId: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        success: z.ZodLiteral<true>;
    }, z.core.$strip>, {
        NOT_FOUND: {
            status: number;
            message: string;
        };
        UNAUTHORIZED: {
            message: string;
        };
    }>;
    testError: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        kind: z.ZodEnum<{
            bad_request: "bad_request";
            conflict: "conflict";
            forbidden: "forbidden";
            internal: "internal";
            not_found: "not_found";
            unauthorized: "unauthorized";
        }>;
    }, z.core.$strip>, z.ZodObject<{
        ok: z.ZodLiteral<true>;
    }, z.core.$strip>, {
        UNAUTHORIZED: {
            message: string;
        };
        FORBIDDEN: {
            message: string;
        };
        NOT_FOUND: {
            message: string;
        };
        CONFLICT: {
            message: string;
        };
        BAD_REQUEST: {
            message: string;
        };
    }>;
};
export type ContractType = typeof contract;
