import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_public/")({
  component: () => <div data-testid="landing-index">Landing index — TENANT landing plugin</div>,
});
