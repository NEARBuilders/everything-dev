import "@orpc/openapi/extensions/route";
import { z } from "zod";
export declare const DocSummarySchema: z.ZodObject<{
    slug: z.ZodString;
    source: z.ZodString;
    title: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    tags: z.ZodArray<z.ZodString>;
    order: z.ZodNumber;
    status: z.ZodOptional<z.ZodString>;
    statusNote: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const DocSchema: z.ZodObject<{
    slug: z.ZodString;
    source: z.ZodString;
    title: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    tags: z.ZodArray<z.ZodString>;
    order: z.ZodNumber;
    status: z.ZodOptional<z.ZodString>;
    statusNote: z.ZodOptional<z.ZodString>;
    file: z.ZodString;
    raw: z.ZodString;
}, z.core.$strip>;
export declare const ListDocsSchema: z.ZodObject<{
    data: z.ZodArray<z.ZodObject<{
        slug: z.ZodString;
        source: z.ZodString;
        title: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        tags: z.ZodArray<z.ZodString>;
        order: z.ZodNumber;
        status: z.ZodOptional<z.ZodString>;
        statusNote: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    meta: z.ZodObject<{
        total: z.ZodNumber;
        hasMore: z.ZodBoolean;
        nextCursor: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const NavNodeSchema: z.ZodObject<{
    label: z.ZodString;
    slug: z.ZodNullable<z.ZodString>;
    title: z.ZodNullable<z.ZodString>;
    order: z.ZodNumber;
    path: z.ZodString;
    children: z.ZodArray<z.ZodObject</*elided*/ any, z.core.$strip>>;
}, z.core.$strip>;
export interface NavNodeShape {
    label: string;
    slug: string | null;
    title: string | null;
    order: number;
    path: string;
    children: NavNodeShape[];
}
export declare const contract: {
    listPublished: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        q: z.ZodOptional<z.ZodString>;
        tag: z.ZodOptional<z.ZodString>;
        source: z.ZodOptional<z.ZodString>;
        limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
        cursor: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        data: z.ZodArray<z.ZodObject<{
            slug: z.ZodString;
            source: z.ZodString;
            title: z.ZodString;
            description: z.ZodOptional<z.ZodString>;
            tags: z.ZodArray<z.ZodString>;
            order: z.ZodNumber;
            status: z.ZodOptional<z.ZodString>;
            statusNote: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        meta: z.ZodObject<{
            total: z.ZodNumber;
            hasMore: z.ZodBoolean;
            nextCursor: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>;
    }, z.core.$strip>, Record<never, never>>;
    getBySlug: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        slug: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        doc: z.ZodObject<{
            slug: z.ZodString;
            source: z.ZodString;
            title: z.ZodString;
            description: z.ZodOptional<z.ZodString>;
            tags: z.ZodArray<z.ZodString>;
            order: z.ZodNumber;
            status: z.ZodOptional<z.ZodString>;
            statusNote: z.ZodOptional<z.ZodString>;
            file: z.ZodString;
            raw: z.ZodString;
        }, z.core.$strip>;
    }, z.core.$strip>, {
        NOT_FOUND: {
            message: string;
        };
    }>;
    getNav: import("@orpc/contract").ProcedureContract<import("@orpc/contract").InitialInputSchema, z.ZodObject<{
        nav: z.ZodArray<z.ZodObject<{
            label: z.ZodString;
            slug: z.ZodNullable<z.ZodString>;
            title: z.ZodNullable<z.ZodString>;
            order: z.ZodNumber;
            path: z.ZodString;
            children: z.ZodArray<z.ZodObject</*elided*/ any, z.core.$strip>>;
        }, z.core.$strip>>;
    }, z.core.$strip>, Record<never, never>>;
};
export type ContractType = typeof contract;
export type DocOutput = z.output<typeof DocSchema>;
