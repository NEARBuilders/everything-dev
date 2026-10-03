/**
 * Generic router error boundary component — shared by the client and SSR
 * router factories. Dependency-free by design: the framework cannot import
 * the app's UI kit, so primitives are plain markup + semantic tokens.
 */

export function RouterError({ error, reset }: { error: Error; reset?: () => void }) {
  return (
    <div
      className="flex min-h-96 flex-1 items-center justify-center bg-background px-4 py-16"
      role="alert"
      data-testid="router-error"
    >
      <div className="flex max-w-md flex-col items-center gap-6 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-destructive-muted text-destructive-muted-foreground">
          <svg className="size-7" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
            <path d="M128 24a104 104 0 1 0 104 104A104.11 104.11 0 0 0 128 24Zm0 192a88 88 0 1 1 88-88 88.1 88.1 0 0 1-88 88Zm-8-80V80a8 8 0 0 1 16 0v56a8 8 0 0 1-16 0Zm20 36a12 12 0 1 1-12-12 12 12 0 0 1 12 12Z" />
          </svg>
        </div>
        <div className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold text-foreground">This page didn’t load</h1>
          <p className="text-base text-muted-foreground">
            Something went wrong on our side. Try again, or head back home.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <a
            href="/"
            data-testid="router-error-home"
            className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            Back home
          </a>
          <button
            type="button"
            onClick={() => (reset ? reset() : window.location.reload())}
            data-testid="router-error-retry"
            className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-background px-4 text-sm font-medium text-foreground"
          >
            Try again
          </button>
        </div>
        <details className="w-full text-left text-sm text-muted-foreground">
          <summary className="cursor-pointer text-center">Error details</summary>
          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-lg bg-muted p-4 font-mono text-xs">
            {error.message}
          </pre>
        </details>
      </div>
    </div>
  );
}
