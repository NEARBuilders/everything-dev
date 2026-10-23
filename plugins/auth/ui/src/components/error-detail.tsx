import { useLoginTranslation } from "@/i18n/runtime";

/**
 * One destructive error line with the server's technical detail collapsed
 * behind a summary — no duplicate toast, no unbounded text on the panel.
 * `testId` keys the message line; `.detail-toggle` / `.detail` extend it.
 */
export function ErrorDetail({
  message,
  detail,
  testId,
}: {
  message: string;
  detail?: string | null;
  testId: string;
}) {
  const t = useLoginTranslation();
  return (
    <div className="flex flex-col items-center gap-1">
      <p className="text-center text-sm text-destructive" data-testid={testId}>
        {message}
      </p>
      {detail && (
        <details className="max-w-full">
          <summary
            className="cursor-pointer text-center text-xs text-muted-foreground select-none"
            data-testid={`${testId}.detail-toggle`}
          >
            {t("auth.error.details")}
          </summary>
          <p
            className="mt-1 max-h-40 overflow-y-auto text-xs break-all text-muted-foreground whitespace-pre-wrap"
            data-testid={`${testId}.detail`}
          >
            {detail}
          </p>
        </details>
      )}
    </div>
  );
}
