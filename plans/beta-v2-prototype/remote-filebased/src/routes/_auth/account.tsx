import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_auth/account")({
  component: () => (
    <div>
      <h1>Account (/account)</h1>
      <p>File-based route · grafted under host `auth` mount</p>
    </div>
  ),
});