import "@orpc/openapi/extensions/route";
import { oc } from "@orpc/contract";
import { z } from "zod";

const Errors = {
  NOT_FOUND: {
    message: "Doc not found",
  },
};

export const DocSummarySchema = z.object({
  slug: z
    .string()
    .describe("Mount-qualified slug, e.g. adr/0012-session-gas-keys or plugins/auth/install"),
  source: z
    .string()
    .describe("Content source: app for the composing app's docs tree, or the plugin's name"),
  title: z.string().describe("Human title: frontmatter, first heading, or slug fallback"),
  description: z.string().optional().describe("Frontmatter description, if authored"),
  tags: z.array(z.string()).describe("Frontmatter tags, empty by default"),
  order: z.number().describe("Sort weight, frontmatter order or 100"),
  status: z
    .string()
    .optional()
    .describe(
      "Lifecycle status parsed from the doc header's Status line (accepted, proposed, superseded)",
    ),
  statusNote: z
    .string()
    .optional()
    .describe("Qualifier from the Status line's parenthetical, e.g. which ADR superseded this one"),
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

export const NavNodeSchema = z.object({
  label: z.string().describe("Directory name, or the prettified page title at the leaf"),
  slug: z.string().nullable().describe("Qualified slug when a page exists at this path"),
  title: z.string().nullable(),
  order: z.number(),
  path: z.string().describe("The directory's qualified path; empty string for page leaves"),
  get children() {
    return z.array(NavNodeSchema).describe("Child nodes, sorted by order then label");
  },
});

export interface NavNodeShape {
  label: string;
  slug: string | null;
  title: string | null;
  order: number;
  path: string;
  children: NavNodeShape[];
}

export const contract = oc.router({
  listPublished: oc
    .route({
      method: "GET",
      path: "/docs",
      summary: "List published docs",
      description:
        "Lists the compiled docs across all content sources with optional query, source and tag filters and opaque-cursor pagination. Query matches against title, slug, description and body text.",
      tags: ["Docs"],
    })
    .input(
      z.object({
        q: z
          .string()
          .optional()
          .describe("Case-insensitive match against title, slug, description and body text"),
        tag: z.string().optional().describe("Filter by tag"),
        source: z
          .string()
          .optional()
          .describe("Filter by content source: app, or a plugin's workspace name"),
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
        slug: z.string().min(1, "Slug is required").describe("Mount-qualified slug"),
      }),
    )
    .output(z.object({ doc: DocSchema }))
    .errors(Errors),

  getNav: oc
    .route({
      method: "GET",
      path: "/docs/nav",
      summary: "Get the docs navigation tree",
      description:
        "The full navigation tree over every content source: one directory node per slug path segment, page nodes at the leaves, sorted by subtree-minimum order then label.",
      tags: ["Docs"],
    })
    .output(z.object({ nav: z.array(NavNodeSchema) })),
});

export type ContractType = typeof contract;

export type DocOutput = z.output<typeof DocSchema>;
