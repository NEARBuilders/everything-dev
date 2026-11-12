import "@orpc/openapi/extensions/route";
import { z } from "zod";
export declare const DocSummarySchema: z.ZodObject<{
    slug: z.ZodString;
    title: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    tags: z.ZodArray<z.ZodString>;
    order: z.ZodNumber;
}, z.core.$strip>;
export declare const DocSchema: z.ZodObject<{
    slug: z.ZodString;
    title: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    tags: z.ZodArray<z.ZodString>;
    order: z.ZodNumber;
    raw: z.ZodString;
}, z.core.$strip>;
export declare const ListDocsSchema: z.ZodObject<{
    data: z.ZodArray<z.ZodObject<{
        slug: z.ZodString;
        title: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        tags: z.ZodArray<z.ZodString>;
        order: z.ZodNumber;
    }, z.core.$strip>>;
    meta: z.ZodObject<{
        total: z.ZodNumber;
        hasMore: z.ZodBoolean;
        nextCursor: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const contract: {
    listPublished: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        q: z.ZodOptional<z.ZodString>;
        tag: z.ZodOptional<z.ZodString>;
        limit: z.ZodDefault<z.ZodNumber>;
        cursor: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        data: z.ZodArray<z.ZodObject<{
            slug: z.ZodString;
            title: z.ZodString;
            description: z.ZodOptional<z.ZodString>;
            tags: z.ZodArray<z.ZodString>;
            order: z.ZodNumber;
        }, z.core.$strip>>;
        meta: z.ZodObject<{
            total: z.ZodNumber;
            hasMore: z.ZodBoolean;
            nextCursor: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>;
    }, z.core.$strip>, object>;
    getBySlug: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        slug: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        doc: z.ZodObject<{
            slug: z.ZodString;
            title: z.ZodString;
            description: z.ZodOptional<z.ZodString>;
            tags: z.ZodArray<z.ZodString>;
            order: z.ZodNumber;
            raw: z.ZodString;
        }, z.core.$strip>;
    }, z.core.$strip>, {
        NOT_FOUND: {
            message: string;
        };
    }>;
};
export type ContractType = typeof contract;
