import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/settings/api-keys")({
  loader: () => ({ keys: ["edk_demo"] }),
  component: () => <div data-testid="api-keys">API keys (auth plugin)</div>,
});
