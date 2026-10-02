import { Button } from "@/components/ui/button";
import { DocumentFallback } from "./document-fallback";

export function RootError() {
  return (
    <DocumentFallback
      title="Something went wrong"
      body="The app hit an error before it could load. Try again in a moment."
      secondaryAction={
        <Button variant="outline" onClick={() => window.location.reload()}>
          Try again
        </Button>
      }
    />
  );
}
