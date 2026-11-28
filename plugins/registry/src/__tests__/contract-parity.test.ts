import { OpenAPIGenerator } from "@orpc/openapi";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  contract,
  getManifestInput,
  getRegistryAppByHostInput,
  isoDateTimeString,
  kvGetInput,
  kvListInput,
  kvPrepareWriteInput,
  listRegistryAppsInput,
  prepareRegistryMetadataWriteInput,
  relayRegistryMetadataWriteInput,
  resolveRuntimeInput,
} from "../contract";

interface StandardSchema {
  "~standard": { validate: (value: unknown) => unknown };
}

async function accepts(schema: StandardSchema, value: unknown): Promise<boolean> {
  const result = (await schema["~standard"].validate(value)) as
    | { value: unknown }
    | { issues: ReadonlyArray<unknown> };
  return !("issues" in result);
}

async function expectParity(
  zodSchema: StandardSchema,
  effectSchema: StandardSchema,
  value: unknown,
) {
  const [zodAccepts, effectAccepts] = await Promise.all([
    accepts(zodSchema, value),
    accepts(effectSchema, value),
  ]);
  expect(
    { value, effectAccepts },
    `zod ${zodAccepts ? "accepts" : "rejects"} but effect ${effectAccepts ? "accepts" : "rejects"}`,
  ).toEqual({ value, effectAccepts: zodAccepts });
}

const legacy = {
  listRegistryAppsInput: z.object({
    q: z.string().optional(),
    parent: z.string().optional(),
    root: z.string().optional(),
    ancestor: z.string().optional(),
    limit: z.number().int().min(1).max(100).optional(),
    cursor: z.string().optional(),
  }),
  getRegistryAppByHostInput: z.object({ hostUrl: z.string().url() }),
  getManifestInput: z.object({
    ref: z.string().startsWith("bos://"),
    includeVersionRecord: z.boolean().optional(),
  }),
  resolveRuntimeInput: z.object({
    ref: z.string().startsWith("bos://"),
    release: z.string().optional(),
  }),
  prepareRegistryMetadataWriteInput: z.object({
    accountId: z.string(),
    gatewayId: z.string(),
    claimedBy: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    repoUrl: z.string().url().optional(),
    homepageUrl: z.string().url().optional(),
    imageUrl: z.string().url().optional(),
  }),
  kvGetInput: z.object({ path: z.string() }),
  kvListInput: z.object({
    prefix: z.string(),
    limit: z.number().int().min(1).max(200).optional(),
    cursor: z.string().optional(),
  }),
  kvPrepareWriteInput: z.object({
    entries: z.array(z.object({ path: z.string(), value: z.unknown() })),
  }),
  relayRegistryMetadataWriteInput: z.object({ payload: z.string() }),
  registryMetadataUpdatedAt: z.iso.datetime(),
};

const battery: Array<{
  name: string;
  zod: StandardSchema;
  effect: StandardSchema;
  values: Array<unknown>;
}> = [
  {
    name: "listRegistryApps input",
    zod: legacy.listRegistryAppsInput,
    effect: listRegistryAppsInput,
    values: [
      {},
      { q: "pingpay" },
      { parent: "a.near", root: "b.near", ancestor: "c.near", cursor: "abc" },
      { limit: 1 },
      { limit: 100 },
      { limit: 0 },
      { limit: 101 },
      { limit: 2.5 },
      { limit: "50" },
      { q: null },
      { limit: 5, extra: true },
    ],
  },
  {
    name: "getRegistryAppByHost input",
    zod: legacy.getRegistryAppByHostInput,
    effect: getRegistryAppByHostInput,
    values: [
      { hostUrl: "https://pingpay.io" },
      { hostUrl: "  https://pingpay.io  " },
      { hostUrl: "not a url" },
      { hostUrl: "http://" },
      { hostUrl: "" },
      { hostUrl: null },
    ],
  },
  {
    name: "getManifest input",
    zod: legacy.getManifestInput,
    effect: getManifestInput,
    values: [
      { ref: "bos://acct/gateway" },
      { ref: "bos://acct/gateway", includeVersionRecord: true },
      { ref: "https://acct/gateway" },
      { ref: "" },
    ],
  },
  {
    name: "resolveRuntime input",
    zod: legacy.resolveRuntimeInput,
    effect: resolveRuntimeInput,
    values: [
      { ref: "bos://acct/gateway" },
      { ref: "bos://acct/gateway", release: "2026.11.1" },
      { ref: "bos://acct/gateway", release: null },
    ],
  },
  {
    name: "prepareRegistryMetadataWrite input",
    zod: legacy.prepareRegistryMetadataWriteInput,
    effect: prepareRegistryMetadataWriteInput,
    values: [
      { accountId: "a.near", gatewayId: "a.io", claimedBy: "b.near" },
      {
        accountId: "a.near",
        gatewayId: "a.io",
        claimedBy: "b.near",
        title: "T",
        description: undefined,
        repoUrl: "https://github.com/a/b",
      },
      {
        accountId: "a.near",
        gatewayId: "a.io",
        claimedBy: "b.near",
        repoUrl: "javascript:alert(1)",
      },
      { accountId: "a.near", gatewayId: "a.io", claimedBy: "b.near", title: null },
      { accountId: "a.near", gatewayId: "a.io" },
      { accountId: 1, gatewayId: "a.io", claimedBy: "b.near" },
    ],
  },
  {
    name: "kvGet input",
    zod: legacy.kvGetInput,
    effect: kvGetInput,
    values: [{ path: "apps/a.near/a.io" }, {}, { path: 5 }],
  },
  {
    name: "kvList input",
    zod: legacy.kvListInput,
    effect: kvListInput,
    values: [
      { prefix: "apps/" },
      { prefix: "apps/", limit: 200 },
      { prefix: "apps/", limit: 201 },
      { prefix: "apps/", limit: 0 },
    ],
  },
  {
    name: "kvPrepareWrite input",
    zod: legacy.kvPrepareWriteInput,
    effect: kvPrepareWriteInput,
    values: [
      { entries: [] },
      { entries: [{ path: "k", value: { any: ["thing", 1, null] } }] },
      { entries: [{ path: "k" }] },
      { entries: "not-an-array" },
    ],
  },
  {
    name: "relay input",
    zod: legacy.relayRegistryMetadataWriteInput,
    effect: relayRegistryMetadataWriteInput,
    values: [{ payload: "base64-or-whatever" }, { payload: "" }, { payload: 5 }],
  },
];

describe("registry contract parity: legacy zod vs Effect Schema", () => {
  for (const entry of battery) {
    if (!entry.effect) continue;
    it(`accepts/rejects identically: ${entry.name}`, async () => {
      for (const value of entry.values) {
        await expectParity(entry.zod, entry.effect, value);
      }
    });
  }

  it("rejects impossible calendar dates exactly like z.iso.datetime", async () => {
    for (const value of [
      "2026-11-27T12:00:00Z",
      "2026-11-27T12:00:00.123Z",
      "2026-02-29T00:00:00Z",
      "2026-02-30T00:00:00Z",
      "2026-13-01T00:00:00Z",
      "2026-11-27T12:00:00+01:00",
      "2026-11-27 12:00:00Z",
      "2026-11-27T12:00:00",
    ]) {
      await expectParity(legacy.registryMetadataUpdatedAt, isoDateTimeString, value);
    }
  });
});

describe("registry contract OpenAPI generation (Effect Schema via Standard JSON Schema)", () => {
  it("generates real schemas for every registry route — no silent empty conversions", async () => {
    const spec: Record<string, any> = await new OpenAPIGenerator().generate(contract as any, {
      version: "3.1.1",
      base: { info: { title: "registry", version: "1" } },
    });

    const specText = JSON.stringify(spec);
    expect(specText).toContain('"format":"uri"');
    expect(specText).toContain('"format":"date-time"');
    expect(specText).toContain("\\\\d\\\\d[2468][048]");
    expect(specText).toContain('"minimum":1');
    expect(specText).toContain('"maximum":100');

    const detailOp = spec.paths["/v1/registry/apps/{accountId}/{gatewayId}"].get;
    expect(detailOp).toBeDefined();
    const responseSchema = detailOp.responses["200"].content["application/json"].schema;
    expect(responseSchema.type).toBe("object");
    const data = responseSchema.properties.data;
    expect(data.type).toBe("object");
    expect(data.properties.accountId.type).toBe("string");
    expect(data.properties.canonicalConfigUrl.format).toBe("uri");
    expect(data.properties.depth.type).toBe("integer");
    expect(responseSchema.required).toContain("data");
  });

  it("rejects an invalid host URL through the generated spec schema", async () => {
    const spec: Record<string, any> = await new OpenAPIGenerator().generate(contract as any, {
      version: "3.1.1",
      base: { info: { title: "registry", version: "1" } },
    });
    const byHost = spec.paths["/v1/registry/apps/by-host"].get;
    const param = byHost.parameters.find((p: any) => p.name === "hostUrl");
    expect(param).toBeDefined();
    expect(param.schema.format).toBe("uri");
  });
});
