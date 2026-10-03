import { TranslateIcon } from "@phosphor-icons/react";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { APP_LOCALE_LABELS, APP_LOCALES, type AppLocale } from "@/i18n/catalogs";
import { useAppLocale, useAppTranslation } from "@/i18n/runtime";

export function LanguageSelector() {
  const { locale, selectLocale } = useAppLocale();
  const t = useAppTranslation();

  return (
    <Select
      value={locale}
      onValueChange={(value) => {
        if (value && APP_LOCALES.includes(value as AppLocale)) {
          void selectLocale(value as AppLocale);
        }
      }}
    >
      <SelectTrigger
        aria-label={t("footer.language")}
        data-testid="public-footer-language"
        variant="footer"
      >
        <TranslateIcon aria-hidden="true" />
        <span className="flex-1 text-left">{APP_LOCALE_LABELS[locale]}</span>
      </SelectTrigger>
      <SelectContent side="top" sideOffset={8} className="min-w-44">
        {APP_LOCALES.map((option) => (
          <SelectItem key={option} value={option} lang={option}>
            {APP_LOCALE_LABELS[option]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
