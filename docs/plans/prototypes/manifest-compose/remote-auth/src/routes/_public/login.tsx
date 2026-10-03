import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_public/login")({
  beforeLoad: ({ context }) => {
    if (context.user) {
      throw redirect({ to: "/" });
    }
  },
  component: () => <div data-testid="login">Login (auth plugin)</div>,
});
