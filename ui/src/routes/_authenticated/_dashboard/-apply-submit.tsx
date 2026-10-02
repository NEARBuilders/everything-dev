import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useAppTranslation } from "@/i18n/runtime";

export function ApplySubmit({
  canSubmit,
  isSubmitting,
}: {
  canSubmit: boolean;
  isSubmitting: boolean;
}) {
  const t = useAppTranslation();
  return (
    <Button
      type="submit"
      className="w-full sm:w-auto sm:self-start"
      disabled={!canSubmit}
      data-testid="apply.submit"
    >
      {isSubmitting && <Spinner />}
      {t(isSubmitting ? "apply.submit.pending" : "apply.submit.action")}
    </Button>
  );
}
