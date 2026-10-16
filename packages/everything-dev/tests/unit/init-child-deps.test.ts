import { describe, expect, it } from "vitest";

import { childFrameworkDependencies } from "../../src/cli/init";

describe("childFrameworkDependencies", () => {
  it("declares optional peers that would otherwise fail to resolve in child builds", () => {
    // @better-auth/core optionally peers @opentelemetry/api; pnpm does not
    // auto-install optional peers, so nothing resolves it unless the child
    // root declares it — the consumer-CI build warning.
    expect(childFrameworkDependencies()["@opentelemetry/api"]).toBe("catalog:");
  });
});
