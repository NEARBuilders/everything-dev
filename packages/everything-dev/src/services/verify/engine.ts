import { createHash } from "node:crypto";
import { Context, Data, Effect, Layer } from "effect";
import type { ZodType } from "zod";

export class IntegrityMismatch extends Data.TaggedError("IntegrityMismatch")<{
  readonly url: string;
  readonly expected: string;
  readonly actual: string;
}> {}

export class ProvenanceUnknown extends Data.TaggedError("ProvenanceUnknown")<{
  readonly url: string;
  readonly cause: unknown;
  readonly status?: number;
}> {}

export class SignatureInvalid extends Data.TaggedError("SignatureInvalid")<{
  readonly url: string;
  readonly reason: string;
}> {}

export type VerifyError = IntegrityMismatch | ProvenanceUnknown | SignatureInvalid;

export const isVerifyError = (error: unknown): error is VerifyError =>
  error instanceof IntegrityMismatch ||
  error instanceof ProvenanceUnknown ||
  error instanceof SignatureInvalid;

export declare const verified: unique symbol;

export type Verified<T> = T & { readonly [verified]: true };

export const mark = <T>(value: T): Verified<T> => value as Verified<T>;

export type Digest = `sha384-${string}`;

export const asDigest = (sri: string): Digest => sri as Digest;

export type VerifiedBytes = Verified<Uint8Array>;

export interface VerifyCallOptions {
  readonly fetchImpl?: typeof fetch;
  readonly cache?: boolean;
}

export interface VerifierShape {
  readonly fetchVerified: (
    url: string,
    expected: Digest,
    options?: VerifyCallOptions,
  ) => Effect.Effect<VerifiedBytes, VerifyError>;
  readonly verifyDocument: <T>(
    url: string,
    expected: Digest,
    schema: ZodType<T>,
    options?: VerifyCallOptions,
  ) => Effect.Effect<Verified<T>, VerifyError>;
  readonly clear: () => void;
}

const verifiedCache = new Map<string, VerifiedBytes>();

export const clearVerifiedCache = (): void => {
  verifiedCache.clear();
};

const sha384Of = (bytes: Uint8Array): Digest =>
  `sha384-${createHash("sha384").update(bytes).digest("base64")}`;

const textOf = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

const fetchVerifiedEffect = (
  url: string,
  expected: Digest,
  options?: VerifyCallOptions,
): Effect.Effect<VerifiedBytes, VerifyError> =>
  Effect.gen(function* () {
    if (options?.cache !== false) {
      const cached = verifiedCache.get(`${url}::${expected}`);
      if (cached) return cached;
    }
    const response = yield* Effect.tryPromise({
      try: () => (options?.fetchImpl ?? fetch)(url),
      catch: (cause) => new ProvenanceUnknown({ url, cause }),
    });
    if (!response.ok) {
      return yield* new ProvenanceUnknown({
        url,
        cause: response.statusText || `HTTP ${response.status}`,
        status: response.status,
      });
    }
    const bytes = new Uint8Array(
      yield* Effect.tryPromise({
        try: () => response.arrayBuffer(),
        catch: (cause) => new ProvenanceUnknown({ url, cause }),
      }),
    );
    const actual = sha384Of(bytes);
    if (actual !== expected) {
      return yield* new IntegrityMismatch({ url, expected, actual });
    }
    const verifiedBytes = mark(bytes);
    if (options?.cache !== false) verifiedCache.set(`${url}::${expected}`, verifiedBytes);
    return verifiedBytes;
  });

const verifyDocumentEffect = <T>(
  url: string,
  expected: Digest,
  schema: ZodType<T>,
  options?: VerifyCallOptions,
): Effect.Effect<Verified<T>, VerifyError> =>
  Effect.gen(function* () {
    const bytes = yield* fetchVerifiedEffect(url, expected, options);
    const document = yield* Effect.try({
      try: () => schema.parse(JSON.parse(textOf(bytes))),
      catch: (cause) => new ProvenanceUnknown({ url, cause }),
    });
    return mark(document);
  });

export class Verifier extends Context.Service<Verifier, VerifierShape>()(
  "everything-dev/verify/Verifier",
) {
  static readonly layer: Layer.Layer<Verifier> = Layer.succeed(
    Verifier,
    Verifier.of({
      fetchVerified: (url, expected, options) => fetchVerifiedEffect(url, expected, options),
      verifyDocument: (url, expected, schema, options) =>
        verifyDocumentEffect(url, expected, schema, options),
      clear: clearVerifiedCache,
    }),
  );
}

export const fetchVerified = (input: {
  url: string;
  expected: Digest;
  fetchImpl?: typeof fetch;
  cache?: boolean;
}): Promise<VerifiedBytes> =>
  Effect.runPromise(
    fetchVerifiedEffect(input.url, input.expected, {
      fetchImpl: input.fetchImpl,
      cache: input.cache,
    }),
  );

export const verifyDocument = <T>(input: {
  url: string;
  expected: Digest;
  schema: ZodType<T>;
  fetchImpl?: typeof fetch;
  cache?: boolean;
}): Promise<Verified<T>> =>
  Effect.runPromise(
    verifyDocumentEffect(input.url, input.expected, input.schema, {
      fetchImpl: input.fetchImpl,
      cache: input.cache,
    }),
  );
