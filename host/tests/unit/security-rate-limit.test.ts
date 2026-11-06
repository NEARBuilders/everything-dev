import { describe, expect, it } from "vitest";
import { isSensitiveMutation, isSessionRead } from "../../src/middleware/security";

const ctxOf = (method: string, path: string) =>
  ({ req: { method, path } }) as Parameters<typeof isSessionRead>[0];

describe("rate limit skips (#634)", () => {
  it("exempts only the GET session read from the general bucket", () => {
    expect(isSessionRead(ctxOf("GET", "/api/auth/get-session"))).toBe(true);
    expect(isSessionRead(ctxOf("POST", "/api/auth/get-session"))).toBe(false);
    expect(isSessionRead(ctxOf("GET", "/api/projects"))).toBe(false);
    expect(isSessionRead(ctxOf("GET", "/api/rpc/auth/getSession"))).toBe(false);
  });

  it("keeps the mutation tier unchanged", () => {
    expect(isSensitiveMutation(ctxOf("POST", "/api/projects"))).toBe(true);
    expect(isSensitiveMutation(ctxOf("POST", "/api/auth/get-session"))).toBe(false);
    expect(isSensitiveMutation(ctxOf("GET", "/api/projects"))).toBe(false);
  });
});
