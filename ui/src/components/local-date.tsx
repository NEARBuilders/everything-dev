import { useClientValue } from "@/hooks";

type LocalDateFormat = "date" | "datetime" | "time" | "relative";

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

export function formatLocalDate(value: Date | string | number, format: LocalDateFormat = "date") {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  if (format === "time") return date.toLocaleTimeString(undefined, { timeStyle: "short" });
  if (format === "datetime") {
    return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  }
  if (format === "relative") {
    const seconds = Math.round((date.getTime() - Date.now()) / 1000);
    const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
    for (const [unit, size] of RELATIVE_UNITS) {
      if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit);
    }
    return formatter.format(seconds, "second");
  }
  return date.toLocaleDateString(undefined, { dateStyle: "medium" });
}

export function useLocalDate(
  value: Date | string | number | null | undefined,
  format: LocalDateFormat = "date",
) {
  return useClientValue(() => (value == null ? "" : formatLocalDate(value, format)), "");
}

export function LocalDate({
  value,
  format = "date",
  fallback = "",
}: {
  value: Date | string | number | null | undefined;
  format?: LocalDateFormat;
  fallback?: string;
}) {
  const text = useLocalDate(value, format);
  const date = value == null ? null : new Date(value);
  const iso = date && !Number.isNaN(date.getTime()) ? date.toISOString() : undefined;
  return <time dateTime={iso}>{text || fallback}</time>;
}
