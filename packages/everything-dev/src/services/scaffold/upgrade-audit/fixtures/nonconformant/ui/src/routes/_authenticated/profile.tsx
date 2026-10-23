import { createFileRoute } from "@tanstack/react-router";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/_authenticated/profile")({
  beforeLoad: async () => {
    await authClient.getSession();
  },
  component: () => null,
});
