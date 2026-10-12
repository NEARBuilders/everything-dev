import { Data, DateTime, Effect } from "effect";
import type { z } from "zod";
// Import types from contract
import type { ItemSchema, SearchResultSchema } from "./contract";

// Infer the types from the schemas
type Item = z.infer<typeof ItemSchema>;
type SearchResult = z.infer<typeof SearchResultSchema>;

/**
 * Tagged failure for the simulated external fetch — keeps the error channel
 * typed instead of merging global `Error`s together.
 */
export class TemplateFetchError extends Data.TaggedError("TemplateFetchError")<{
  readonly cause: unknown;
}> {
  override get message() {
    return this.cause instanceof Error ? this.cause.message : String(this.cause);
  }
}

/**
 * Template Service - Wraps external API calls with Effect-based error handling.
 */
export class TemplateService {
  constructor(
    readonly baseUrl: string,
    readonly _apiKey: string,
    readonly timeout: number,
  ) {}

  getById(id: string) {
    const { baseUrl, timeout } = this;
    return Effect.gen(function* () {
      yield* Effect.logInfo(`[TemplateService] Fetching from ${baseUrl} with timeout ${timeout}ms`);
      const createdAt = DateTime.formatIso(yield* DateTime.now);
      yield* Effect.sleep(50);

      if (id === "not-found") {
        return yield* new TemplateFetchError({ cause: new Error("Item not found") });
      }

      return {
        id,
        title: `Item ${id}`,
        createdAt,
      } satisfies Item;
    });
  }

  search(query: string, limit: number): AsyncGenerator<SearchResult> {
    return (async function* () {
      for (let i = 0; i < limit; i++) {
        yield {
          item: {
            id: `${query}-${i}`,
            title: `${query} result ${i + 1}`,
            createdAt: new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString(),
          },
          score: Math.max(0.1, 1 - i * 0.1),
        };
      }
    })();
  }

  readonly ping = Effect.gen(function* () {
    yield* Effect.sleep("10 millis");
    return {
      status: "ok" as const,
      timestamp: DateTime.formatIso(yield* DateTime.now),
    };
  });
}
