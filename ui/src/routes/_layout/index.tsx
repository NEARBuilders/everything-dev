import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_layout/")({
  loader: () => {
    throw redirect({ to: "/about" });
  },
});
