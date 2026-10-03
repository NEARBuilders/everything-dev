import { afterEach, describe, expect, it } from "vitest";
import { resolvePoolSsl } from "../../src/db/driver";

const withEnv = (value: string | undefined, fn: () => void) => {
  const prev = process.env.DB_SSL_REJECT_UNAUTHORIZED;
  if (value === undefined) delete process.env.DB_SSL_REJECT_UNAUTHORIZED;
  else process.env.DB_SSL_REJECT_UNAUTHORIZED = value;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.DB_SSL_REJECT_UNAUTHORIZED;
    else process.env.DB_SSL_REJECT_UNAUTHORIZED = prev;
  }
};

describe("resolvePoolSsl", () => {
  it("disables TLS for local urls regardless of sslmode", () => {
    for (const url of [
      "postgres://localhost:5432/db",
      "postgres://user:pw@127.0.0.1:5433/auth_db",
      "postgres://u@host.docker.internal:5432/db?sslmode=require",
      "postgresql://postgres:pw@auth-db.railway.internal:5432/railway",
      "postgresql://postgres:pw@api-db.railway.internal:5432/railway?sslmode=require",
    ]) {
      expect(resolvePoolSsl(url)).toBe(false);
    }
  });

  it("libpq require/prefer/allow encrypt without verifying", () => {
    withEnv(undefined, () => {
      for (const mode of ["prefer", "allow", "require"]) {
        expect(resolvePoolSsl(`postgres://db.example.com:5432/db?sslmode=${mode}`)).toEqual({
          rejectUnauthorized: false,
        });
      }
    });
  });

  it("libpq verify-ca/verify-full verify the certificate", () => {
    withEnv(undefined, () => {
      for (const mode of ["verify-ca", "verify-full"]) {
        expect(resolvePoolSsl(`postgres://db.example.com:5432/db?sslmode=${mode}`)).toEqual({
          rejectUnauthorized: true,
        });
      }
    });
  });

  it("sslmode=disable turns TLS off", () => {
    withEnv(undefined, () => {
      expect(resolvePoolSsl("postgres://db.example.com:5432/db?sslmode=disable")).toBe(false);
    });
  });

  it("defaults to verification on for bare non-local urls", () => {
    withEnv(undefined, () => {
      expect(resolvePoolSsl("postgres://db.example.com:5432/db")).toEqual({
        rejectUnauthorized: true,
      });
    });
  });

  it("treats an unparseable url as bare (verify on)", () => {
    withEnv(undefined, () => {
      expect(resolvePoolSsl("not a url at all")).toEqual({ rejectUnauthorized: true });
    });
  });

  it("DB_SSL_REJECT_UNAUTHORIZED=false overrides the url", () => {
    withEnv("false", () => {
      expect(resolvePoolSsl("postgres://db.example.com:5432/db?sslmode=verify-full")).toEqual({
        rejectUnauthorized: false,
      });
      expect(resolvePoolSsl("postgres://localhost:5432/db")).toBe(false);
    });
  });

  it("DB_SSL_REJECT_UNAUTHORIZED=true overrides the url", () => {
    withEnv("true", () => {
      expect(resolvePoolSsl("postgres://db.example.com:5432/db?sslmode=require")).toEqual({
        rejectUnauthorized: true,
      });
      expect(resolvePoolSsl("postgres://db.example.com:5432/db?sslmode=disable")).toEqual({
        rejectUnauthorized: true,
      });
    });
  });

  afterEach(() => {
    delete process.env.DB_SSL_REJECT_UNAUTHORIZED;
  });
});
