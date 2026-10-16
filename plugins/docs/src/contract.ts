import "@orpc/openapi/extensions/route";
import { oc } from "@orpc/contract";
import { z } from "zod";

const Errors = {
  NOT_FOUND: {
    message: "Doc not found",
  },
};

export const DocSummarySchema = z.object({
  slug: z.string().describe("Doc slug, path-derived, e.g. adr/0012-session-gas-keys"),
  title: z.string().describe("Human title: frontmatter, first heading, or slug fallback"),
  description: z.string().optional().describe("Frontmatter description, if authored"),
  tags: z.array(z.string()).describe("Frontmatter tags, empty by default"),
  order: z.number().describe("Sort weight, frontmatter order or 100"),
});

export const DocSchema = DocSummarySchema.extend({
  raw: z.string().describe("Raw markdown body, frontmatter stripped"),
});

export const ListDocsSchema = z.object({
  data: z.array(DocSummarySchema).describe("Docs matching the query"),
  meta: z.object({
    total: z.number().describe("Total number of matching docs"),
    hasMore: z.boolean().describe("Whether another page of results exists"),
    nextCursor: z.string().nullable().describe("Opaque cursor for the next page, or null if done"),
  }),
});

export const contract = oc.router({
  listPublished: oc
    .route({
      method: "GET",
      path: "/docs",
      summary: "List published docs",
      description:
        "Lists the repository's compiled docs with optional query and tag filters and opaque-cursor pagination.",
      tags: ["Docs"],
    })
    .input(
      z.object({
        q: z
          .string()
          .optional()
          .describe("Case-insensitive match against title, slug, description"),
        tag: z.string().optional().describe("Filter by tag"),
        limit: z.number().min(1).max(100).default(20).describe("Maximum number of docs to return"),
        cursor: z.string().optional().describe("Opaque cursor for the next page"),
      }),
    )
    .output(ListDocsSchema),

  getBySlug: oc
    .route({
      method: "GET",
      path: "/docs/{slug}",
      summary: "Get a doc by slug",
      description: "Returns a single doc's metadata and raw markdown body.",
      tags: ["Docs"],
    })
    .input(
      z.object({
        slug: z.string().min(1, "Slug is required").describe("Doc slug"),
      }),
    )
    .output(z.object({ doc: DocSchema }))
    .errors(Errors),
});

export type ContractType = typeof contract;
