import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { checkRoutes } from "../../../src/services/scaffold/upgrade-audit/checks/routes";
import { blockerMessages, warnMessages } from "./test-helpers";

const conformant = join(
  import.meta.dirname,
  "../../../src/services/scaffold/upgrade-audit/fixtures/conformant",
);
const nonconformant = join(
  import.meta.dirname,
  "../../../src/services/scaffold/upgrade-audit/fixtures/nonconformant",
);

describe("checkRoutes", () => {
  it("passes the conformant fixture with no blockers", async () => {
    const findings = await Effect.runPromise(checkRoutes(conformant));
    expect(blockerMessages(findings)).toEqual([]);
  });

  it("blocks flat routes not mounted under a pathless layout", async () => {
    const findings = await Effect.runPromise(checkRoutes(nonconformant));
    expect(blockerMessages(findings).join("\n")).toMatch(
      /about.*not mounted under a pathless layout/s,
    );
  });

  it("blocks unknown mounts outside the host registry", async () => {
    const findings = await Effect.runPromise(checkRoutes(nonconformant));
    expect(blockerMessages(findings).join("\n")).toMatch(/unknown mount "_weird"/);
  });

  it("blocks authed layouts without a beforeLoad gate", async () => {
    const findings = await Effect.runPromise(checkRoutes(nonconformant));
    expect(blockerMessages(findings).join("\n")).toMatch(/no beforeLoad gate/);
  });

  it("warns on leaf routes resolving the session directly", async () => {
    const findings = await Effect.runPromise(checkRoutes(nonconformant));
    expect(warnMessages(findings).join("\n")).toMatch(/leaf route resolves the session directly/);
  });

  it("warns on a thick root that owns the document shell", async () => {
    const findings = await Effect.runPromise(checkRoutes(nonconformant));
    expect(warnMessages(findings).join("\n")).toMatch(/root route owns the document shell/);
  });
});
