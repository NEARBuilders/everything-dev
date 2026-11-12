import "@orpc/openapi/extensions/route";
import { fromJsonSchema } from "@modelcontextprotocol/server";
import { oc } from "@orpc/contract";
import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildToolInputSchema } from "../../src/services/mcp";

async function operationAndComponents(contract: Record<string, any>, path: string) {
  const spec: any = await new OpenAPIGenerator({
    converters: [new ZodToJsonSchemaConverter()],
  }).generate(contract as any, { version: "3.1.1", base: { info: { title: "t", version: "1" } } });
  return { operation: spec.paths[path].post, components: spec.components?.schemas ?? {} };
}

function validate(schema: Record<string, unknown>, value: unknown) {
  return (fromJsonSchema(schema as any) as any)["~standard"].validate(value);
}

describe("buildToolInputSchema", () => {
  it("makes a recursive body schema self-contained so the tool compiles", async () => {
    const { operation, components } = await operationAndComponents(
      {
        submit: oc
          .route({ method: "POST", path: "/events" })
          .input(z.object({ name: z.string(), payload: z.json() })),
      },
      "/events",
    );

    const schema = buildToolInputSchema(operation, components);

    expect(JSON.stringify(schema)).not.toContain("#/components/");
    expect(validate(schema, { name: "a", payload: { nested: [1, { deep: null }] } })).toEqual({
      value: { name: "a", payload: { nested: [1, { deep: null }] } },
    });
    expect(validate(schema, { payload: {} }).issues).toBeDefined();
  });

  it("leaves schemas without component refs free of $defs", async () => {
    const { operation, components } = await operationAndComponents(
      {
        submit: oc.route({ method: "POST", path: "/items" }).input(z.object({ name: z.string() })),
      },
      "/items",
    );

    expect(buildToolInputSchema(operation, components)).toEqual({
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    });
  });

  it("names the missing component when a ref cannot be resolved", () => {
    const operation = {
      parameters: [],
      requestBody: {
        content: { "application/json": { schema: { $ref: "#/components/schemas/Gone" } } },
      },
    };

    expect(() => buildToolInputSchema(operation as any, {})).toThrow(
      /not present in the OpenAPI spec.*Gone/,
    );
  });
});
