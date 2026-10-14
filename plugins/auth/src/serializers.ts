export function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  return value ? new Date(value as string) : new Date();
}
