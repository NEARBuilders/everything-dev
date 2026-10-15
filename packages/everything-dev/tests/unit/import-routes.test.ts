import { describe, expect, it } from "vitest";
import { computeRouteDelta, extractContractRoutes } from "../../src/cli/import";

describe("bos import — extractContractRoutes", () => {
  const source = `
const contract = {
  health: oc.route({ method: "GET", path: "/health" }).output(z.string()),
  create: oc.route({ method: "POST", path: "/v1/demo/local" }).output(z.void()),
  nested: oc.route({
    method: "PUT",
    path: "/v1/demo/upstream",
    meta: { description: "keeps balanced parens (like this)" },
  }),
  computed: oc.route({ method: methodVar, path: dynamicPath }),
  duplicate: oc.route({ method: "GET", path: "/health" }),
};
`;

  it("extracts literal method/path pairs sorted, skipping computed routes", () => {
    expect(extractContractRoutes(source)).toEqual([
      "GET /health",
      "POST /v1/demo/local",
      "PUT /v1/demo/upstream",
    ]);
  });

  it("returns an empty list for source without routes", () => {
    expect(extractContractRoutes("export const x = 1;")).toEqual([]);
  });
});

describe("bos import — computeRouteDelta", () => {
  it("splits ours-only and theirs-only routes", () => {
    expect(computeRouteDelta(["GET /a", "POST /b"], ["GET /a", "PUT /c"])).toEqual({
      oursOnly: ["POST /b"],
      theirsOnly: ["PUT /c"],
    });
  });

  it("returns empty deltas for identical route sets", () => {
    expect(computeRouteDelta(["GET /a"], ["GET /a"])).toEqual({
      oursOnly: [],
      theirsOnly: [],
    });
  });
});
