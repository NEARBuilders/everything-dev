import { type Messages, setupI18n } from "@lingui/core";
import { I18nProvider, useLingui } from "@lingui/react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";

type LocaleStore = {
  get: () => string;
  set: (locale: string) => void;
  subscribe: (listener: () => void) => () => void;
};

const browserStores = new Map<string, LocaleStore>();

function createLocaleStore(initialLocale: string): LocaleStore {
  let locale = initialLocale;
  const listeners = new Set<() => void>();
  return {
    get: () => locale,
    set: (nextLocale) => {
      if (nextLocale === locale) return;
      locale = nextLocale;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function readLocaleCookie(cookie: string, cookieName: string): string | undefined {
  for (const part of cookie.split(";")) {
    const [name, ...valueParts] = part.trim().split("=");
    if (name !== cookieName) continue;
    try {
      return decodeURIComponent(valueParts.join("="));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function matchLocale<const Locale extends string>(
  candidate: string | null | undefined,
  locales: readonly Locale[],
): Locale | undefined {
  if (!candidate) return undefined;
  const normalized = candidate.toLowerCase();
  const exact = locales.find((locale) => locale.toLowerCase() === normalized);
  if (exact) return exact;
  const base = normalized.split("-")[0];
  return locales.find((locale) => locale.toLowerCase() === base);
}

export function resolveLocale<const Locale extends string>({
  preferredLocale,
  cookie,
  browserLocales,
  locales,
  defaultLocale,
  cookieName,
}: {
  preferredLocale?: string | null;
  cookie: string;
  browserLocales: readonly string[];
  locales: readonly Locale[];
  defaultLocale: Locale;
  cookieName: string;
}): Locale {
  const preferred = matchLocale(preferredLocale, locales);
  if (preferred) return preferred;
  const saved = matchLocale(readLocaleCookie(cookie, cookieName), locales);
  if (saved) return saved;
  for (const browserLocale of browserLocales) {
    const matched = matchLocale(browserLocale, locales);
    if (matched) return matched;
  }
  return defaultLocale;
}

export function serializeLocaleCookie(cookieName: string, locale: string, secure: boolean): string {
  return `${cookieName}=${encodeURIComponent(locale)}; Path=/; Max-Age=31536000; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export function createLocaleRuntime<const Locale extends string>({
  locales,
  defaultLocale,
  cookieName,
}: {
  locales: readonly Locale[];
  defaultLocale: Locale;
  cookieName: string;
}) {
  type ContextValue = {
    locale: Locale;
    selectLocale: (locale: Locale) => Promise<void>;
  };

  const LocaleContext = createContext<ContextValue | null>(null);

  const getBrowserLocales = (): readonly string[] => {
    if (typeof navigator === "undefined") return [];
    if (Array.isArray(navigator.languages)) return navigator.languages;
    return navigator.language ? [navigator.language] : [];
  };

  const detectLocale = (preferredLocale?: string | null): Locale =>
    resolveLocale({
      preferredLocale,
      cookie: typeof document === "undefined" ? "" : document.cookie,
      browserLocales: getBrowserLocales(),
      locales,
      defaultLocale,
      cookieName,
    });

  const getStore = (preferredLocale?: string | null) => {
    if (typeof window === "undefined") return createLocaleStore(detectLocale(preferredLocale));
    const existing = browserStores.get(cookieName);
    if (existing) return existing;
    const store = createLocaleStore(detectLocale(preferredLocale));
    browserStores.set(cookieName, store);
    return store;
  };

  function LocaleProvider({
    children,
    messages,
    preferredLocale,
    onLocaleChange,
  }: {
    children: ReactNode;
    messages: (locale: Locale) => Messages;
    preferredLocale?: string | null;
    onLocaleChange?: (locale: Locale) => void | Promise<void>;
  }) {
    const store = useMemo(() => getStore(preferredLocale), []);
    const locale = useSyncExternalStore(store.subscribe, store.get, () => defaultLocale) as Locale;
    const i18n = useMemo(
      () => setupI18n({ locale, messages: { [locale]: messages(locale) } }),
      [locale, messages],
    );

    useEffect(() => {
      const resolved = matchLocale(preferredLocale, locales);
      if (resolved) store.set(resolved);
    }, [preferredLocale, store]);

    useEffect(() => {
      const previousLocale = document.documentElement.lang;
      document.documentElement.lang = locale;
      return () => {
        document.documentElement.lang = previousLocale;
      };
    }, [locale]);

    const selectLocale = useCallback(
      async (nextLocale: Locale) => {
        if (!locales.includes(nextLocale)) return;
        if (typeof document !== "undefined") {
          Reflect.set(
            document,
            "cookie",
            serializeLocaleCookie(
              cookieName,
              nextLocale,
              typeof window !== "undefined" && window.location.protocol === "https:",
            ),
          );
        }
        store.set(nextLocale);
        await onLocaleChange?.(nextLocale);
      },
      [onLocaleChange, store],
    );

    const value = useMemo(() => ({ locale, selectLocale }), [locale, selectLocale]);
    return (
      <LocaleContext.Provider value={value}>
        <I18nProvider i18n={i18n}>{children}</I18nProvider>
      </LocaleContext.Provider>
    );
  }

  function useLocale(): ContextValue {
    const value = useContext(LocaleContext);
    if (!value) throw new Error("useLocale must be used within LocaleProvider");
    return value;
  }

  function useTranslation<MessageId extends string>() {
    const { _ } = useLingui();
    return useCallback(
      (id: MessageId, values?: Record<string, string | number>) => _(id, values),
      [_],
    );
  }

  return { LocaleProvider, useLocale, useTranslation, detectLocale };
}
