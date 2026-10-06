export type LocaleOptions<Locale extends string = string> = {
  locales: readonly Locale[];
  defaultLocale: Locale;
  cookieName: string;
};

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
  const normalized = candidate.trim().toLowerCase();
  const exact = locales.find((locale) => locale.toLowerCase() === normalized);
  if (exact) return exact;
  const base = normalized.split("-")[0];
  return locales.find((locale) => locale.toLowerCase() === base);
}

export function readAcceptLanguage(header: string | null): string[] {
  return (header ?? "")
    .split(",")
    .map((part, index) => {
      const [language = "", ...parameters] = part.trim().split(";");
      const quality = parameters.find((parameter) => parameter.trim().startsWith("q="));
      return { language, quality: quality ? Number(quality.trim().slice(2)) : 1, index };
    })
    .filter(({ language, quality }) => language && quality > 0 && quality <= 1)
    .sort((a, b) => b.quality - a.quality || a.index - b.index)
    .map(({ language }) => language);
}

export function resolveLocale<const Locale extends string>({
  preferredLocale,
  cookie,
  browserLocales,
  locales,
  defaultLocale,
  cookieName,
}: LocaleOptions<Locale> & {
  preferredLocale?: string | null;
  cookie: string;
  browserLocales: readonly string[];
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
