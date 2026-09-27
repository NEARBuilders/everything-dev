import { describe, expect, it } from "vitest";
import { maskDbUrl } from "../../src/utils/mask-db-url";

describe("maskDbUrl", () => {
  it("masks the password in a URL with credentials", () => {
    expect(maskDbUrl("postgres://user:secret@host:5432/db")).toBe(
      "postgres://user:****@host:5432/db",
    );
  });

  it("masks the password in a pglite URL", () => {
    expect(maskDbUrl("pglite://user:secret@localhost:5432/db")).toBe(
      "pglite://user:****@localhost:5432/db",
    );
  });

  it("leaves URLs without a password untouched", () => {
    expect(maskDbUrl("postgres://localhost:5432/db")).toBe("postgres://localhost:5432/db");
    expect(maskDbUrl("postgres://user@localhost:5432/db")).toBe(
      "postgres://user@localhost:5432/db",
    );
  });

  it("masks credentials in strings that are not valid URLs", () => {
    expect(maskDbUrl("connection string user:pass@db")).toBe("connection string user:****@db");
  });

  it("leaves strings without credentials untouched", () => {
    expect(maskDbUrl("")).toBe("");
    expect(maskDbUrl("unset")).toBe("unset");
    expect(maskDbUrl("not a url at all")).toBe("not a url at all");
  });

  it("only masks the first credential segment when a value contains multiple @ signs", () => {
    expect(maskDbUrl("postgres://user:p@ss:word@host/db")).toBe(
      "postgres://user:****@ss:word@host/db",
    );
  });
});
