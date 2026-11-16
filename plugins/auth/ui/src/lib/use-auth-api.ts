import { useRouter } from "@tanstack/react-router";
import type { AuthApiClient } from "@/lib/api";

export function useAuthApi(): AuthApiClient {
  return useRouter().options.context.apiClient.auth as AuthApiClient;
}
