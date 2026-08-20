import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/_layout/_public/things/")({
  head: () => ({
    meta: [
      { title: "Things | everything.dev" },
      { name: "description", content: "Thing registry — create, browse, and vote on things." },
    ],
  }),
  component: ThingsIndex,
});

function ThingsIndex() {
  const navigate = useNavigate();
  const [lookupId, setLookupId] = useState("");

  const handleLookup = (e: React.FormEvent) => {
    e.preventDefault();
    if (lookupId.trim()) {
      void navigate({ to: "/things/$thingId", params: { thingId: lookupId.trim() } });
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4 py-2.5 sm:px-6 sm:py-3">
        <h1 className="text-xl font-semibold text-foreground">Things</h1>
        <Link
          to="/things/new"
          className="h-9 rounded-[12px] bg-primary px-4 text-sm font-bold text-primary-foreground inline-flex items-center no-underline transition-colors duration-150 hover:opacity-90"
        >
          New thing
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-lg space-y-6">
          <div className="rounded-[12px] border border-border bg-card p-6 space-y-4">
            <p className="text-sm text-muted-foreground">
              The thing registry is a generic API-owned durable store. Each thing has a plugin-owned
              type and payload, supports upvotes, and emits real-time SSE events.
            </p>
          </div>

          <div className="rounded-[12px] border border-border bg-card p-6 space-y-3">
            <h2 className="text-sm font-semibold text-foreground">Look up a thing</h2>
            <form onSubmit={handleLookup} className="flex gap-2">
              <input
                type="text"
                value={lookupId}
                onChange={(e) => setLookupId(e.target.value)}
                placeholder="thing_1234567890_abc123"
                className="min-w-0 flex-1 rounded-[8px] border-2 border-border bg-background px-3 py-2 text-xs font-mono text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
              />
              <button
                type="submit"
                disabled={!lookupId.trim()}
                className="h-9 rounded-[8px] bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-40"
              >
                Go
              </button>
            </form>
          </div>

          <div className="flex gap-3">
            <Link
              to="/things/live"
              className="text-xs text-muted-foreground hover:text-foreground underline transition-colors"
            >
              Live stream
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
