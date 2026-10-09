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
import { matchLocale, resolveLocale, serializeLocaleCookie } from "./locale";

export { Trans } from "@lingui/react";
export type { LocaleOptions } from "./locale";
export {
  matchLocale,
  readAcceptLanguage,
  readLocaleCookie,
  resolveLocale,
  serializeLocaleCookie,
} from "./locale";
export { createMessageCatalogs } from "./message-catalogs";

type SharedLocaleState = {
  cookieName: string;
  locale: string;
  selectLocale: (locale: string) => Promise<void>;
};

const SharedLocaleContext = createContext<SharedLocaleState | null>(null);

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

  const getStore = (initialLocale?: string | null) => {
    const initial = matchLocale(initialLocale, locales) ?? detectLocale();
    if (typeof window === "undefined") return createLocaleStore(initial);
    const existing = browserStores.get(cookieName);
    if (existing) return existing;
    const store = createLocaleStore(initial);
    browserStores.set(cookieName, store);
    return store;
  };

  function LocaleProvider({
    children,
    messages,
    initialLocale,
    preferredLocale,
    onLocaleChange,
  }: {
    children: ReactNode;
    messages: (locale: Locale) => Messages;
    initialLocale?: string | null;
    preferredLocale?: string | null;
    onLocaleChange?: (locale: Locale) => void | Promise<void>;
  }) {
    const parent = useContext(SharedLocaleContext);
    const sharedParent = parent?.cookieName === cookieName ? parent : null;
    const resolvedInitial =
      matchLocale(preferredLocale, locales) ??
      matchLocale(initialLocale, locales) ??
      matchLocale(sharedParent?.locale, locales);
    const serverLocale = resolvedInitial ?? defaultLocale;
    const store = useMemo(() => getStore(resolvedInitial), []);
    const locale = useSyncExternalStore(store.subscribe, store.get, () => serverLocale) as Locale;
    const i18n = useMemo(
      () => setupI18n({ locale, messages: { [locale]: messages(locale) } }),
      [locale, messages],
    );

    useEffect(() => {
      if (sharedParent) return;
      const resolved = matchLocale(preferredLocale, locales);
      if (resolved) {
        Reflect.set(
          document,
          "cookie",
          serializeLocaleCookie(cookieName, resolved, window.location.protocol === "https:"),
        );
        store.set(resolved);
      }
    }, [preferredLocale, sharedParent, store]);

    useEffect(() => {
      if (sharedParent) return;
      const previousLocale = document.documentElement.lang;
      document.documentElement.lang = locale;
      return () => {
        document.documentElement.lang = previousLocale;
      };
    }, [locale, sharedParent]);

    const selectLocale = useCallback(
      async (nextLocale: Locale) => {
        if (!locales.includes(nextLocale)) return;
        if (sharedParent && !onLocaleChange) {
          await sharedParent.selectLocale(nextLocale);
          return;
        }
        if (onLocaleChange) await onLocaleChange(nextLocale);
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
      },
      [onLocaleChange, sharedParent, store],
    );

    const value = useMemo(() => ({ locale, selectLocale }), [locale, selectLocale]);
    const sharedValue = useMemo(
      () => ({
        cookieName,
        locale,
        selectLocale: async (next: string) => {
          const matched = matchLocale(next, locales);
          if (matched) await selectLocale(matched);
        },
      }),
      [locale, selectLocale],
    );
    return (
      <SharedLocaleContext.Provider value={sharedValue}>
        <LocaleContext.Provider value={value}>
          <I18nProvider i18n={i18n}>{children}</I18nProvider>
        </LocaleContext.Provider>
      </SharedLocaleContext.Provider>
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

  const getLocale = (): Locale =>
    matchLocale(browserStores.get(cookieName)?.get(), locales) ?? detectLocale();

  return { LocaleProvider, useLocale, useTranslation, detectLocale, getLocale };
}
