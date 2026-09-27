import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export function ApplySubmit({
  canSubmit,
  isSubmitting,
}: {
  canSubmit: boolean;
  isSubmitting: boolean;
}) {
  return (
    <Button
      type="submit"
      className="w-full sm:w-auto sm:self-start"
      disabled={!canSubmit}
      data-testid="apply.submit"
    >
      {isSubmitting && <Spinner />}
      {isSubmitting ? "Submitting…" : "Submit for review"}
    </Button>
  );
}
