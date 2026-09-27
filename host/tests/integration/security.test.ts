import { Effect, Layer } from "effect";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { SecurityMiddleware } from "../../src/middleware/security";
import { ConfigService } from "../../src/services/config";
import { loadTestRuntimeConfig } from "../helpers/runtime-config";

describe("request origin validation", () => {
  let app: Hono;

  beforeAll(async () => {
    const config = await loadTestRuntimeConfig();
    const middleware = await Effect.runPromise(
      SecurityMiddleware.pipe(
        Effect.provide(SecurityMiddleware.Live),
        Effect.provide(Layer.succeed(ConfigService, config)),
      ),
    );
    app = new Hono();
    app.use("*", middleware.csrf);
    app.post("/write", (context) => context.json({ written: true }));
  });

  it.each([
    "null",
    "not-a-url",
    "https://[invalid",
    "https://other.test",
  ])("rejects origin %s without a server error", async (origin) => {
    const response = await app.request("http://app.test/write", {
      method: "POST",
      headers: { host: "app.test", origin },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "CSRF validation failed: request origin is not allowed",
    });
  });

  it.each([undefined, "http://app.test"])("allows supported origin %s", async (origin) => {
    const response = await app.request("http://app.test/write", {
      method: "POST",
      headers: { host: "app.test", ...(origin ? { origin } : {}) },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ written: true });
  });
});
