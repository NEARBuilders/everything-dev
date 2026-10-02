import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { DocumentFallback } from "./document-fallback";

export function RootNotFound() {
  return (
    <DocumentFallback
      code="404"
      title="Page not found"
      body="This link may be old, or the page has moved."
      secondaryAction={
        <Button variant="outline" nativeButton={false} render={<Link to="/explore" />}>
          Explore communities
        </Button>
      }
    />
  );
}
