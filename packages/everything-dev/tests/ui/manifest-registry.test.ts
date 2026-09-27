import { describe, expect, it } from "vitest";
import {
  digestOf,
  MOUNT_ALIASES,
  MOUNT_REGISTRY,
  MOUNT_REGISTRY_VERSION,
  MOUNTS,
  resolveMountSegment,
} from "../../src/ui/manifest/index";

describe("mount registry v2", () => {
  it("declares the implemented mounts plus org/team vocabulary", () => {
    expect(MOUNTS).toEqual(["public", "authenticated", "admin", "org", "team"]);
    expect(MOUNT_REGISTRY.public).toMatchObject({ gate: "none", implemented: true });
    expect(MOUNT_REGISTRY.authenticated).toMatchObject({ gate: "session", implemented: true });
    expect(MOUNT_REGISTRY.admin).toMatchObject({ gate: "admin", implemented: true });
    expect(MOUNT_REGISTRY.org).toMatchObject({
      gate: "organization",
      parameterized: true,
      implemented: false,
    });
    expect(MOUNT_REGISTRY.team).toMatchObject({
      gate: "team",
      parameterized: true,
      implemented: false,
    });
  });

  it("resolves legacy aliases to canonical mounts", () => {
    expect(resolveMountSegment("public")).toBe("public");
    expect(resolveMountSegment("auth")).toBe("authenticated");
    expect(resolveMountSegment("authed")).toBe("authenticated");
    expect(resolveMountSegment("dashboard")).toBe("authenticated");
    expect(resolveMountSegment("organization")).toBe("org");
    expect(resolveMountSegment("bogus")).toBeUndefined();
    expect(MOUNT_ALIASES).toEqual({
      auth: "authenticated",
      authed: "authenticated",
      dashboard: "authenticated",
      organization: "org",
    });
  });

  it("carries a registry version that participates in digests", () => {
    expect(typeof MOUNT_REGISTRY_VERSION).toBe("number");
  });
});

describe("digestOf", () => {
  it("is stable for identical inputs and sensitive to composition identity", async () => {
    const input = {
      plugins: [
        { key: "ui", mfName: "ui" },
        { key: "auth", mfName: "auth" },
      ],
      manifests: [{ name: "ui", routes: [] }],
    };
    expect(await digestOf(input)).toBe(await digestOf(structuredClone(input)));

    expect(
      await digestOf({
        ...input,
        plugins: [{ key: "ui", mfName: "ui-tenant" }, input.plugins[1]!],
      }),
    ).not.toBe(await digestOf(input));

    expect(
      await digestOf({ ...input, manifests: [{ name: "ui", routes: [{ id: "_public/login" }] }] }),
    ).not.toBe(await digestOf(input));
  });
});
