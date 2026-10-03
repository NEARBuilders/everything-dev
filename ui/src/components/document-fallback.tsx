import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { LogoMark } from "@/components/logo";
import { Button } from "@/components/ui/button";

interface DocumentFallbackProps {
  code?: string;
  title: string;
  body: string;
  secondaryAction?: ReactNode;
}

export function DocumentFallback({ code, title, body, secondaryAction }: DocumentFallbackProps) {
  return (
    <div
      className="flex min-h-dvh items-center justify-center bg-background px-4 text-foreground"
      data-testid="document-fallback"
    >
      <div className="flex max-w-md flex-col items-center gap-6 text-center">
        <LogoMark size="lg" />
        <div className="flex flex-col gap-3">
          {code && <p className="font-mono text-sm text-muted-foreground">{code}</p>}
          <h1 className="text-3xl font-semibold sm:text-4xl">{title}</h1>
          <p className="text-base text-muted-foreground">{body}</p>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <Button nativeButton={false} render={<Link to="/" />} data-testid="fallback-home">
            Back home
          </Button>
          {secondaryAction}
        </div>
      </div>
    </div>
  );
}
