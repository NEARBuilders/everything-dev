export interface AuthCallbacks {
  onSuccess?: () => void;
  onError?: (error: Error & { status?: number; code?: string }) => void;
}
