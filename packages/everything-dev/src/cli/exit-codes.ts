/** The CLI's exit-code mapping (ticket #426): one place decides the process
 * exit code from a command result — status "error", a bare error string, or
 * an explicit `code` field. */
export type ExitCode = 0 | 1;

export function exitCodeFor(
  result:
    | {
        status?: string;
        error?: string;
        code?: number;
      }
    | undefined,
): ExitCode {
  if (!result) return 0;
  if (typeof result.code === "number") return (result.code === 0 ? 0 : 1) as ExitCode;
  if (result.status === "error") return 1;
  if (typeof result.error === "string" && result.error.length > 0) return 1;
  return 0;
}
