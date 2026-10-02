import { Clock, Context, Duration, Effect, Layer, Ref, Semaphore } from "effect";

export type GeocodeResult =
  | { ok: true; latitude: number; longitude: number }
  | { ok: false; reason: "not_found" | "unavailable" };

export type GeocodeIdentity = {
  domain: string;
  repository: string;
};

type CacheEntry = { latitude: number; longitude: number; expiresAt: number };

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const MIN_INTERVAL = Duration.millis(1100);
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeLocation(location: string) {
  return location.trim().replace(/\s+/g, " ").toLowerCase();
}

function clampLatitude(value: number) {
  return Math.min(85, Math.max(-85, value));
}

function clampLongitude(value: number) {
  return Math.min(180, Math.max(-180, value));
}

export function nominatimUserAgent(identity: GeocodeIdentity) {
  const domain = identity.domain.trim() || "localhost";
  const repository = identity.repository.trim();
  return repository
    ? `${domain}/discovery-geocode (${repository}; geocode)`
    : `${domain}/discovery-geocode (geocode)`;
}

export type GeocodeService = {
  geocode: (location: string) => Effect.Effect<GeocodeResult>;
  resetForTests: Effect.Effect<void>;
};

const runFetch = (url: string | URL, init?: RequestInit): Promise<Response> => fetch(url, init);

export class GeocodeTag extends Context.Service<GeocodeTag, GeocodeService>()("api/Geocode") {}

export const GeocodeLive = (identity: GeocodeIdentity) =>
  Layer.effect(
    GeocodeTag,
    Effect.gen(function* () {
      const cache = yield* Ref.make(new Map<string, CacheEntry>());
      const lastRequestAt = yield* Ref.make(0);
      const lock = yield* Semaphore.make(1);
      const userAgent = nominatimUserAgent(identity);

      const readCache = (key: string) =>
        Ref.get(cache).pipe(
          Effect.map((entries) => {
            const cached = entries.get(key);
            if (!cached || cached.expiresAt <= Date.now()) return null;
            return {
              ok: true as const,
              latitude: cached.latitude,
              longitude: cached.longitude,
            };
          }),
        );

      const lookupNominatim = (location: string, key: string) =>
        Effect.gen(function* () {
          const last = yield* Ref.get(lastRequestAt);
          const now = yield* Clock.currentTimeMillis;
          const waitMs = Math.max(0, Duration.toMillis(MIN_INTERVAL) - (now - last));
          if (waitMs > 0) yield* Effect.sleep(Duration.millis(waitMs));
          yield* Ref.set(lastRequestAt, yield* Clock.currentTimeMillis);

          const url = new URL(NOMINATIM_URL);
          url.searchParams.set("q", location.trim());
          url.searchParams.set("format", "json");
          url.searchParams.set("limit", "1");

          const result = yield* Effect.tryPromise({
            try: async (): Promise<GeocodeResult> => {
              const response = await runFetch(url, {
                headers: {
                  Accept: "application/json",
                  "User-Agent": userAgent,
                },
                signal: AbortSignal.timeout(8_000),
              });
              if (!response.ok) return { ok: false, reason: "unavailable" };
              const rows = (await response.json()) as Array<{ lat?: string; lon?: string }>;
              const first = rows[0];
              const latitude = first?.lat !== undefined ? Number(first.lat) : Number.NaN;
              const longitude = first?.lon !== undefined ? Number(first.lon) : Number.NaN;
              if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
                return { ok: false, reason: "not_found" };
              }
              return {
                ok: true,
                latitude: clampLatitude(latitude),
                longitude: clampLongitude(longitude),
              };
            },
            catch: (): GeocodeResult => ({ ok: false, reason: "unavailable" }),
          }).pipe(Effect.catch((error) => Effect.succeed(error)));

          if (result.ok) {
            yield* Ref.update(cache, (entries) => {
              const next = new Map(entries);
              next.set(key, {
                latitude: result.latitude,
                longitude: result.longitude,
                expiresAt: Date.now() + CACHE_TTL_MS,
              });
              return next;
            });
          }
          return result;
        });

      const geocode = Effect.fn("geocodeLocation")(function* (location: string) {
        const key = normalizeLocation(location);
        if (!key) return { ok: false as const, reason: "not_found" as const };

        const hit = yield* readCache(key);
        if (hit) return hit;

        return yield* lock.withPermits(1)(
          Effect.gen(function* () {
            const cached = yield* readCache(key);
            if (cached) return cached;
            return yield* lookupNominatim(location, key);
          }),
        );
      });

      return GeocodeTag.of({
        geocode,
        resetForTests: Effect.gen(function* () {
          yield* Ref.set(cache, new Map());
          yield* Ref.set(lastRequestAt, 0);
        }),
      });
    }),
  );

export function shouldGeocodeProfile(input: {
  location: string;
  latitude: number | null;
  longitude: number | null;
  geocodedLocation?: string | null;
}) {
  const location = input.location.trim();
  if (!location) return false;
  const hasCoords = input.latitude !== null && input.longitude !== null;
  const geocodedFor = input.geocodedLocation?.trim() || null;
  if (hasCoords && geocodedFor === location) return false;
  return true;
}
