import { useSyncExternalStore } from "react";

const emptySubscribe = () => () => {};

export function useClientValue<T>(clientValue: () => T, serverValue: T): T {
  return useSyncExternalStore(emptySubscribe, clientValue, () => serverValue);
}

const canMatchMedia = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function";

const mediaQueries = new Map<string, MediaQueryList | null>();

function getMediaQuery(query: string): MediaQueryList | null {
  if (!canMatchMedia()) return null;
  let media = mediaQueries.get(query);
  if (!media) {
    media = window.matchMedia(query);
    if (media) mediaQueries.set(query, media);
  }
  return media;
}

export function useMediaQuery(query: string, fallback = false): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = getMediaQuery(query);
      if (!media) return () => {};
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => getMediaQuery(query)?.matches ?? fallback,
    () => fallback,
  );
}

export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 768px)", true);
}
