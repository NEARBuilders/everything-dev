import { describe, expect, it } from "vitest";
import { keyPathOf, parseRuntimeRef, runtimeRefOf } from "../../src/services/registry/keys";
import {
  DEFAULT_PARENT_ACCOUNT,
  DEFAULT_PARENT_GATEWAY,
} from "../../src/services/scaffold/init-flow";

/**
 * The scaffold-root invariant (ticket 04): the default parent the scaffold
 * extends when the operator names none is the production root — and the
 * ONLY default gateway in the codebase. The dead-end `dev.everything.dev`
 * gateway (the gateway incident's false alarm) must never reappear here.
 * The live half — the root's manifest serving — is the nightly sentinel's
 * subject (ticket 12); this locks the constants and their key shape.
 */
describe("scaffold root invariant", () => {
  it("defaults to the production root, never the dead-end gateway", () => {
    expect(DEFAULT_PARENT_ACCOUNT).toBe("dev.everything.near");
    expect(DEFAULT_PARENT_GATEWAY).toBe("everything.dev");
  });

  it("the default ref parses and keys exactly like the published root", () => {
    const ref = runtimeRefOf({
      accountId: DEFAULT_PARENT_ACCOUNT,
      gatewayId: DEFAULT_PARENT_GATEWAY,
    });
    expect(ref).toBe("bos://dev.everything.near/everything.dev");

    const parsed = parseRuntimeRef(ref);
    expect(parsed.accountId).toBe("dev.everything.near");
    expect(parsed.gatewayId).toBe("everything.dev");

    const configKey = keyPathOf({
      kind: "runtimeConfig",
      ref: runtimeRefOf({ accountId: parsed.accountId, gatewayId: parsed.gatewayId }),
    });
    expect(configKey).toBe("apps/dev.everything.near/everything.dev/bos.config.json");

    const manifestKey = keyPathOf({
      kind: "manifest",
      ref: runtimeRefOf({ accountId: parsed.accountId, gatewayId: parsed.gatewayId }),
    });
    expect(manifestKey).toBe("apps/dev.everything.near/everything.dev/manifest.json");

    const versionKey = keyPathOf({
      kind: "version",
      ref: runtimeRefOf({ accountId: parsed.accountId, gatewayId: parsed.gatewayId }),
      version: "2.0.0-rc.37",
    });
    expect(versionKey).toBe("apps/dev.everything.near/everything.dev/versions/2.0.0-rc.37.json");
  });

  it("the dead-end form is a different runtime — the diagnostic keys name it", () => {
    const deadEnd = runtimeRefOf({
      accountId: "dev.everything.near",
      gatewayId: "dev.everything.dev",
    });
    expect(deadEnd).not.toBe(
      runtimeRefOf({ accountId: DEFAULT_PARENT_ACCOUNT, gatewayId: DEFAULT_PARENT_GATEWAY }),
    );
  });
});
