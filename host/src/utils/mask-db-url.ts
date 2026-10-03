export function maskDbUrl(url: string): string {
  return url.replace(/:[^:@/]+@/, ":****@");
}
