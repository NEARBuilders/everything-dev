import { expect, it } from "@effect/vitest";
import { Data, Effect, Stream } from "effect";
import { createPluginRuntime } from "every-plugin/runtime";
import { describe } from "vitest";
import { TEST_REGISTRY } from "../registry";

class BackgroundStreamError extends Data.TaggedError("BackgroundStreamError")<{
  readonly cause: unknown;
}> {
  override get message() {
    return `Background stream failed: ${this.cause instanceof Error ? this.cause.message : String(this.cause)}`;
  }
}

const wallClockNow = () => Date.now();

const backgroundConfig = (baseUrl: string) => ({
  variables: {
    baseUrl,
    timeout: 5000,
    backgroundEnabled: true,
    backgroundIntervalMs: 200,
    backgroundMaxItems: 5,
  },
  secrets: {
    apiKey: "test-api-key-value",
  },
});

// Distinct configs keep each test on its own plugin instance (and therefore
// its own background producer) — structurally-equal configs now share one
// cached instance whose producer stops after backgroundMaxItems events.
const SINGLE_CONSUMER_CONFIG = backgroundConfig("http://localhost:1337");
const MULTI_CONSUMER_CONFIG = backgroundConfig("http://localhost:1338");

const SECRETS_CONFIG = {
  API_KEY: "test-api-key-value",
};

describe.sequential("Background Producer Integration Tests", () => {
  const runtime = createPluginRuntime({
    registry: TEST_REGISTRY,
    secrets: SECRETS_CONFIG,
  });

  it.effect(
    "should test background producer and consumer pattern",
    () =>
      Effect.gen(function* () {
        yield* Effect.log("🚀 Testing background producer/consumer with real Module Federation");

        const { createClient } = yield* Effect.promise(() =>
          runtime.usePlugin("test-plugin", SINGLE_CONSUMER_CONFIG),
        );

        const client = createClient();
        yield* Effect.log("✅ Plugin initialized with background producer enabled");

        // Ping to confirm basic connectivity
        const pingResult = yield* Effect.tryPromise(() => client.ping()).pipe(
          Effect.timeout("6 seconds"),
        );

        yield* Effect.log(`🏓 Ping successful: ${pingResult.ok} at ${pingResult.timestamp}`);
        expect(pingResult.ok).toBe(true);

        // Start consuming events immediately while producer is running
        yield* Effect.log("🔄 Starting event consumption");

        const streamResult = yield* Effect.tryPromise({
          try: () => client.listenBackground({ maxResults: 3 }),
          catch: (cause) => new BackgroundStreamError({ cause }),
        });

        const stream = Stream.fromAsyncIterable(streamResult, (cause) => {
          const error = new BackgroundStreamError({ cause });
          console.error("❌ Background stream error:", error);
          return error;
        });

        // Collect events as they arrive in real-time
        const events = yield* stream.pipe(
          Stream.tap((event) =>
            Effect.gen(function* () {
              yield* Effect.log(
                `🔍 Received background event in real-time: ${event.id} (index: ${event.index})`,
              );
              expect(event.id).toMatch(/^bg-\d+$/);
              expect(event.index).toBeGreaterThan(0);
              expect(event.timestamp).toBeGreaterThan(0);
            }),
          ),
          Stream.take(3),
          Stream.runCollect,
          Effect.timeout("5 seconds"),
        );

        const eventArray = Array.from(events);
        yield* Effect.log(`✅ Collected ${eventArray.length} background events in real-time`);
        expect(eventArray.length).toBe(3);

        // Plugin runtime uses a live Clock; @effect/vitest installs TestClock
        // (epoch 0) in this fiber — compare against wall time, not TestClock.
        const wallNow = wallClockNow();
        for (const event of eventArray) {
          expect(event.id).toMatch(/^bg-\d+$/);
          expect(event.index).toBeGreaterThan(0);
          expect(typeof event.timestamp).toBe("number");
          expect(event.timestamp).toBeLessThanOrEqual(wallNow);
        }

        // Verify sequential ordering
        for (let i = 1; i < eventArray.length; i++) {
          const prevEvent = eventArray[i - 1];
          const currEvent = eventArray[i];
          if (prevEvent && currEvent) {
            const prevId = parseInt(prevEvent.id.replace("bg-", ""), 10);
            const currId = parseInt(currEvent.id.replace("bg-", ""), 10);
            expect(currId).toBeGreaterThan(prevId);
          }
        }

        yield* Effect.log("🎉 background producer/consumer test completed successfully!");
      }).pipe(Effect.timeout("15 seconds")),
    { timeout: 20000 },
  );

  it.effect(
    "should handle multiple consumers simultaneously",
    () =>
      Effect.gen(function* () {
        yield* Effect.log("🚀 Testing multiple consumers simultaneously");

        const { createClient } = yield* Effect.promise(() =>
          runtime.usePlugin("test-plugin", MULTI_CONSUMER_CONFIG),
        );

        const client = createClient();
        // Test multiple consumers reading from same publisher
        yield* Effect.log("🔄 Starting multiple consumer streams");

        const consumer1 = Effect.tryPromise({
          try: () => client.listenBackground({ maxResults: 3 }),
          catch: (cause) => new BackgroundStreamError({ cause }),
        }).pipe(
          Effect.flatMap((streamResult) => {
            const stream = Stream.fromAsyncIterable(
              streamResult,
              (cause) => new BackgroundStreamError({ cause }),
            );
            return stream.pipe(Stream.take(3), Stream.runCollect);
          }),
        );

        const consumer2 = Effect.tryPromise({
          try: () => client.listenBackground({ maxResults: 2 }),
          catch: (cause) => new BackgroundStreamError({ cause }),
        }).pipe(
          Effect.flatMap((streamResult) => {
            const stream = Stream.fromAsyncIterable(
              streamResult,
              (cause) => new BackgroundStreamError({ cause }),
            );
            return stream.pipe(Stream.take(2), Stream.runCollect);
          }),
        );

        // Run both consumers concurrently
        const [events1, events2] = yield* Effect.all([consumer1, consumer2], {
          concurrency: "unbounded",
        }).pipe(Effect.timeout("8 seconds"));

        const array1 = Array.from(events1);
        const array2 = Array.from(events2);

        yield* Effect.log(`✅ Consumer 1 received ${array1.length} events`);
        yield* Effect.log(`✅ Consumer 2 received ${array2.length} events`);

        expect(array1.length).toBe(3);
        expect(array2.length).toBe(2);

        // Collect all received IDs to verify pub/sub behavior
        const allIds = [...array1, ...array2].map((e) => e.id);
        const uniqueIds = new Set(allIds);
        yield* Effect.log(`📊 Total events: ${allIds.length}, Unique IDs: ${uniqueIds.size}`);

        // Pub/sub broadcasts to all consumers - events SHOULD be duplicated
        expect(uniqueIds.size).toBeLessThan(allIds.length);

        // Verify overlap between consumers (proving broadcast behavior)
        const consumer1Ids = new Set(array1.map((e) => e.id));
        const consumer2Ids = new Set(array2.map((e) => e.id));
        const overlap = [...consumer1Ids].filter((id) => consumer2Ids.has(id));
        expect(overlap.length).toBeGreaterThan(0);
        yield* Effect.log(
          `✅ Broadcast verified: ${overlap.length} events received by both consumers`,
        );

        // Plugin runtime uses a live Clock; @effect/vitest installs TestClock
        // (epoch 0) in this fiber — compare against wall time, not TestClock.
        const wallNow = wallClockNow();
        [...array1, ...array2].forEach((event) => {
          expect(event.id).toMatch(/^bg-\d+$/);
          expect(event.index).toBeGreaterThan(0);
          expect(typeof event.timestamp).toBe("number");
          expect(event.timestamp).toBeLessThanOrEqual(wallNow);
        });

        // Verify each consumer individually has sequential events
        // (We don't check ordering across consumers since they connect at different times)
        const seqConsumer1Ids = array1.map((e) => parseInt(e.id.replace("bg-", ""), 10));
        const seqConsumer2Ids = array2.map((e) => parseInt(e.id.replace("bg-", ""), 10));

        for (let i = 0; i < seqConsumer1Ids.length - 1; i++) {
          const curr = seqConsumer1Ids[i];
          const next = seqConsumer1Ids[i + 1];
          if (curr !== undefined && next !== undefined) {
            expect(next).toBeGreaterThan(curr);
          }
        }
        for (let i = 0; i < seqConsumer2Ids.length - 1; i++) {
          const curr = seqConsumer2Ids[i];
          const next = seqConsumer2Ids[i + 1];
          if (curr !== undefined && next !== undefined) {
            expect(next).toBeGreaterThan(curr);
          }
        }

        yield* Effect.log("🎉 Multiple consumers test completed!");
      }).pipe(Effect.timeout("15 seconds")),
    { timeout: 20000 },
  );
});
