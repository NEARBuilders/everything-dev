import { LOGIN_LOCALE_LABELS, LOGIN_LOCALES, type LoginLocale } from "./catalogs";
import { useLoginLocale, useLoginTranslation } from "./runtime";

export function LoginLanguageSelector({
  id,
  testId = "login.language-select",
}: {
  id?: string;
  testId?: string;
} = {}) {
  const { locale, selectLocale } = useLoginLocale();
  const t = useLoginTranslation();

  return (
    <select
      id={id}
      aria-label={t("auth.login.language")}
      className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
      data-testid={testId}
      value={locale}
      onChange={(event) => selectLocale(event.target.value as LoginLocale)}
    >
      {LOGIN_LOCALES.map((option) => (
        <option key={option} value={option} lang={option}>
          {LOGIN_LOCALE_LABELS[option]}
        </option>
      ))}
    </select>
  );
}
