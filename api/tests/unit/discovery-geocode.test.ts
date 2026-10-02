import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GeocodeLive,
  GeocodeTag,
  nominatimUserAgent,
  shouldGeocodeProfile,
} from "../../src/services/discovery-geocode";

const identity = {
  domain: "citynode.app",
  repository: "https://github.com/NEARBuilders/citynode.app",
};

const runGeocode = <A>(program: Effect.Effect<A, never, GeocodeTag>) =>
  Effect.runPromise(program.pipe(Effect.provide(GeocodeLive(identity))));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("shouldGeocodeProfile", () => {
  it("geocodes when location is set and coordinates are empty", () => {
    expect(
      shouldGeocodeProfile({
        location: "Karachi",
        latitude: null,
        longitude: null,
        geocodedLocation: null,
      }),
    ).toBe(true);
  });

  it("geocodes when coordinates exist without a matching geocoded location", () => {
    expect(
      shouldGeocodeProfile({
        location: "Karachi",
        latitude: 24.86,
        longitude: 67.01,
        geocodedLocation: null,
      }),
    ).toBe(true);
  });

  it("re-geocodes when the location changes after a prior geocode", () => {
    expect(
      shouldGeocodeProfile({
        location: "Lahore",
        latitude: 24.86,
        longitude: 67.01,
        geocodedLocation: "Karachi",
      }),
    ).toBe(true);
  });

  it("skips when coordinates already match the geocoded location", () => {
    expect(
      shouldGeocodeProfile({
        location: "Karachi",
        latitude: 24.86,
        longitude: 67.01,
        geocodedLocation: "Karachi",
      }),
    ).toBe(false);
  });
});

describe("nominatimUserAgent", () => {
  it("uses the runtime domain and repository", () => {
    expect(nominatimUserAgent(identity)).toBe(
      "citynode.app/discovery-geocode (https://github.com/NEARBuilders/citynode.app; geocode)",
    );
  });
});

describe("geocodeLocation", () => {
  it("returns coordinates from Nominatim and caches them", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ lat: "24.86", lon: "67.01" }],
    });
    vi.stubGlobal("fetch", fetchMock);

    const { first, second, userAgent } = await runGeocode(
      Effect.gen(function* () {
        const geocode = yield* GeocodeTag;
        const first = yield* geocode.geocode("Karachi");
        const second = yield* geocode.geocode("Karachi");
        return { first, second, userAgent: nominatimUserAgent(identity) };
      }),
    );

    expect(first).toEqual({ ok: true, latitude: 24.86, longitude: 67.01 });
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      "User-Agent": userAgent,
    });
  });

  it("returns not_found when Nominatim has no match", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [],
      }),
    );
    expect(
      await runGeocode(
        Effect.gen(function* () {
          const geocode = yield* GeocodeTag;
          return yield* geocode.geocode("nowhere-land-xyz");
        }),
      ),
    ).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("returns unavailable when Nominatim errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => [],
      }),
    );
    expect(
      await runGeocode(
        Effect.gen(function* () {
          const geocode = yield* GeocodeTag;
          return yield* geocode.geocode("Karachi");
        }),
      ),
    ).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("rate-limits distinct Nominatim lookups to at most ~1 request/sec", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ lat: "1", lon: "2" }],
    });
    vi.stubGlobal("fetch", fetchMock);

    const started = Date.now();
    await runGeocode(
      Effect.gen(function* () {
        const geocode = yield* GeocodeTag;
        yield* geocode.geocode("Place A");
        yield* geocode.geocode("Place B");
      }),
    );
    const elapsed = Date.now() - started;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(elapsed).toBeGreaterThanOrEqual(1100);
    for (const call of fetchMock.mock.calls) {
      expect(call[1]?.headers).toMatchObject({
        "User-Agent": nominatimUserAgent(identity),
      });
    }
  });

  it("serves concurrent identical lookups from cache without a second request", async () => {
    let resolveFetch!: (value: { ok: boolean; json: () => Promise<unknown> }) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const results = runGeocode(
      Effect.gen(function* () {
        const geocode = yield* GeocodeTag;
        return yield* Effect.all([geocode.geocode("Karachi"), geocode.geocode("Karachi")], {
          concurrency: 2,
        });
      }),
    );

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    resolveFetch({
      ok: true,
      json: async () => [{ lat: "24.86", lon: "67.01" }],
    });

    expect(await results).toEqual([
      { ok: true, latitude: 24.86, longitude: 67.01 },
      { ok: true, latitude: 24.86, longitude: 67.01 },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
