import { createHash } from "node:crypto";
import { Effect } from "effect";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  asDigest,
  clearVerifiedCache,
  fetchVerified,
  IntegrityMismatch,
  isVerifyError,
  Verifier,
  verifyDocument,
} from "../../src/services/verify/engine";

const sriOf = (content: string): string =>
  `sha384-${createHash("sha384").update(content).digest("base64")}`;

const BODY = "the distributed bytes";
const URL = "https://cdn.test/a.test/g.test/ui/remoteEntry.abc.js";

const countingFetch = (body: string, status = 200) => {
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    calls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    return new Response(body, { status });
  }) as typeof fetch;
  return { impl, calls };
};

const failingFetch = (message: string): typeof fetch =>
  (async () => {
    throw new Error(message);
  }) as typeof fetch;

beforeEach(() => clearVerifiedCache());

describe("fetchVerified", () => {
  it("returns the fetched bytes when the served digest matches the pin", async () => {
    const { impl } = countingFetch(BODY);
    const bytes = await fetchVerified({
      url: URL,
      expected: asDigest(sriOf(BODY)),
      fetchImpl: impl,
    });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(bytes)).toBe(BODY);
  });

  it("fails with IntegrityMismatch naming expected and actual", async () => {
    const { impl } = countingFetch(BODY);
    const expected = asDigest(sriOf("tampered bytes"));
    try {
      await fetchVerified({ url: URL, expected, fetchImpl: impl });
      expect.unreachable();
    } catch (error) {
      expect(isVerifyError(error) && error._tag).toBe("IntegrityMismatch");
      if (isVerifyError(error) && error._tag === "IntegrityMismatch") {
        expect(error.url).toBe(URL);
        expect(error.expected).toBe(expected);
        expect(error.actual).toBe(sriOf(BODY));
      }
    }
  });

  it("maps a network failure to ProvenanceUnknown with the cause", async () => {
    try {
      await fetchVerified({
        url: URL,
        expected: asDigest(sriOf(BODY)),
        fetchImpl: failingFetch("ECONNREFUSED"),
      });
      expect.unreachable();
    } catch (error) {
      expect(isVerifyError(error) && error._tag).toBe("ProvenanceUnknown");
      if (isVerifyError(error) && error._tag === "ProvenanceUnknown") {
        expect(error.url).toBe(URL);
        expect(error.cause).toBeInstanceOf(Error);
        expect(error.status).toBeUndefined();
      }
    }
  });

  it("maps a non-ok status to ProvenanceUnknown carrying the status", async () => {
    const { impl } = countingFetch("gone", 404);
    try {
      await fetchVerified({ url: URL, expected: asDigest(sriOf(BODY)), fetchImpl: impl });
      expect.unreachable();
    } catch (error) {
      expect(isVerifyError(error) && error._tag).toBe("ProvenanceUnknown");
      if (isVerifyError(error) && error._tag === "ProvenanceUnknown") {
        expect(error.status).toBe(404);
      }
    }
  });

  it("caches a verified pin for the process lifetime — the second resolution performs no fetch", async () => {
    const { impl, calls } = countingFetch(BODY);
    const expected = asDigest(sriOf(BODY));
    await fetchVerified({ url: URL, expected, fetchImpl: impl });
    await fetchVerified({ url: URL, expected, fetchImpl: impl });
    expect(calls).toHaveLength(1);
  });

  it("cache:false audits live bytes and does not populate the cache", async () => {
    const { impl, calls } = countingFetch(BODY);
    const expected = asDigest(sriOf(BODY));
    await fetchVerified({ url: URL, expected, fetchImpl: impl, cache: false });
    await fetchVerified({ url: URL, expected, fetchImpl: impl, cache: false });
    await fetchVerified({ url: URL, expected, fetchImpl: impl });
    expect(calls).toHaveLength(3);
  });

  it("keys the cache by pin — a different expected digest for the same url refetches", async () => {
    const { impl, calls } = countingFetch(BODY);
    await fetchVerified({ url: URL, expected: asDigest(sriOf(BODY)), fetchImpl: impl });
    await expect(
      fetchVerified({ url: URL, expected: asDigest(sriOf("other")), fetchImpl: impl }),
    ).rejects.toThrowError(IntegrityMismatch);
    expect(calls).toHaveLength(2);
  });
});

describe("verifyDocument", () => {
  const schema = z.object({ version: z.string(), entry: z.string() });
  const document = JSON.stringify({ version: "8f3ac1d2feedbeef", entry: "remoteEntry.js" });

  it("returns the parsed document over verified bytes", async () => {
    const { impl } = countingFetch(document);
    const doc = await verifyDocument({
      url: URL,
      expected: asDigest(sriOf(document)),
      schema,
      fetchImpl: impl,
    });
    expect(doc.version).toBe("8f3ac1d2feedbeef");
    expect(doc.entry).toBe("remoteEntry.js");
  });

  it("maps a schema failure over digest-matching bytes to ProvenanceUnknown", async () => {
    const malformed = JSON.stringify({ nope: true });
    const { impl } = countingFetch(malformed);
    try {
      await verifyDocument({
        url: URL,
        expected: asDigest(sriOf(malformed)),
        schema,
        fetchImpl: impl,
      });
      expect.unreachable();
    } catch (error) {
      expect(isVerifyError(error) && error._tag).toBe("ProvenanceUnknown");
      if (isVerifyError(error) && error._tag === "ProvenanceUnknown") {
        expect(error.cause).toBeInstanceOf(z.ZodError);
      }
    }
  });

  it("shares the engine cache — a second document resolution performs no fetch", async () => {
    const { impl, calls } = countingFetch(document);
    const expected = asDigest(sriOf(document));
    await verifyDocument({ url: URL, expected, schema, fetchImpl: impl });
    await verifyDocument({ url: URL, expected, schema, fetchImpl: impl });
    expect(calls).toHaveLength(1);
  });
});

describe("Verifier service", () => {
  const schema = z.object({ entry: z.string() });
  const document = JSON.stringify({ entry: "remoteEntry.js" });

  const run = (impl: typeof fetch) =>
    Effect.gen(function* () {
      const verifier = yield* Verifier;
      return yield* verifier.verifyDocument(URL, asDigest(sriOf(document)), schema, {
        fetchImpl: impl,
      });
    }).pipe(Effect.provide(Verifier.layer), Effect.runPromise);

  it("resolves the engine through the Context.Service tag", async () => {
    const { impl } = countingFetch(document);
    const doc = await run(impl);
    expect(doc.entry).toBe("remoteEntry.js");
  });

  it("shares the process-lifetime cache across service instances", async () => {
    const { impl, calls } = countingFetch(document);
    await run(impl);
    const second = countingFetch(document);
    const doc = await run(second.impl);
    expect(doc.entry).toBe("remoteEntry.js");
    expect(second.calls).toHaveLength(0);
    expect(calls).toHaveLength(1);
  });

  it("clear drops the cache", async () => {
    const { impl, calls } = countingFetch(document);
    await run(impl);
    await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* Verifier;
        service.clear();
      }).pipe(Effect.provide(Verifier.layer)),
    );
    await fetchVerified({ url: URL, expected: asDigest(sriOf(document)), fetchImpl: impl });
    expect(calls).toHaveLength(2);
  });
});
