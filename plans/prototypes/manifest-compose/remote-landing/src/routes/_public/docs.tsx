import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_public/docs")({
  staticData: { nav: { label: "Docs", order: 10 } },
  component: () => <div data-testid="docs">Docs (landing plugin)</div>,
});
