import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { encodeRuntimeConfig } from "../../src/orchestrator";

describe("encodeRuntimeConfig", () => {
  it("omits undefined object properties and converts undefined array entries to null", async () => {
    const encoded = await Effect.runPromise(
      encodeRuntimeConfig({
        ui: { publicUrl: undefined, source: "local" },
        plugins: [{ variables: undefined, routes: [undefined, "home"] }],
      }),
    );

    expect(encoded).toBe('{"ui":{"source":"local"},"plugins":[{"routes":[null,"home"]}]}');
  });
});
