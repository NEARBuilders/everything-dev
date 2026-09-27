import { useNearAccountId } from "better-near-auth/react";

import { useAuthClient } from "./auth";

export function useNearAccount(): string | null {
  const auth = useAuthClient();
  return useNearAccountId(auth);
}
