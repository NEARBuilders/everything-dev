export interface UploadScope {
  account: string;
  gateway: string;
}

export interface UploadAuthConfig {
  authOrigin: string | null;
  bootstrapApiKey: string | null;
  bootstrapScope: UploadScope | null;
  requiredPermissions: Record<string, string[]>;
}

export interface VerifiedApiKey {
  id: string;
  configId: string;
  referenceId: string;
  name: string | null;
  metadata: unknown;
  permissions: Record<string, string[]> | null;
}

export type UploadAuthFailure =
  | {
      authorized: false;
      status: "UNAUTHORIZED";
      message: string;
      data: {
        apiKeyProvided: boolean;
        provider?: string;
        authType?: "apiKey" | "oauth" | "token";
      };
    }
  | {
      authorized: false;
      status: "FORBIDDEN";
      message: string;
      data: {
        requiredPermissions?: string[];
        action?: string;
      };
    }
  | {
      authorized: false;
      status: "CONNECTION_ERROR";
      message: string;
      data: {
        errorCode?: string;
        host?: string;
        port?: number;
        suggestion?: string;
      };
    };

export type UploadAuthResult =
  | {
      authorized: true;
      mode: "bootstrap";
      scope: UploadScope;
    }
  | {
      authorized: true;
      mode: "api-key";
      scope: UploadScope;
      key: VerifiedApiKey;
    }
  | UploadAuthFailure;

const WRITE_PERMISSIONS = { bundles: ["write"] };
const READ_PERMISSIONS = { bundles: ["read"] };

export type UploadPermission = "write" | "read";

export const requiredPermissionsFor = (permission: UploadPermission): Record<string, string[]> =>
  permission === "write" ? WRITE_PERMISSIONS : READ_PERMISSIONS;

const trimTrailingSlash = (value: string | null | undefined): string | null =>
  value?.replace(/\/$/, "") ?? null;

const tryParseJson = (value: string): unknown | null => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parseStringArrayRecord(value: unknown): Record<string, string[]> | null {
  if (!isRecord(value)) return null;
  const entries: Record<string, string[]> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!Array.isArray(raw) || !raw.every((entry) => typeof entry === "string")) return null;
    entries[key] = [...raw];
  }
  return entries;
}

function parseScope(metadata: unknown): UploadScope | null {
  const candidate = typeof metadata === "string" ? tryParseJson(metadata) : metadata;
  if (!isRecord(candidate)) return null;

  const account = candidate.account;
  const gateway = candidate.gateway;
  if (typeof account !== "string" || typeof gateway !== "string") return null;
  if (account.length === 0 || gateway.length === 0) return null;
  return { account, gateway };
}

function hasRequiredPermissions(
  permissions: Record<string, string[]> | null,
  required: Record<string, string[]>,
): boolean {
  if (!permissions) return false;
  for (const [permission, actions] of Object.entries(required)) {
    const granted = permissions[permission];
    if (!granted) return false;
    for (const action of actions) {
      if (!granted.includes(action)) return false;
    }
  }
  return true;
}

export function readUploadAuthConfig(env: NodeJS.ProcessEnv = process.env): UploadAuthConfig {
  return {
    authOrigin: trimTrailingSlash(env.BOS_STORAGE_AUTH_ORIGIN),
    bootstrapApiKey: env.BOS_STORAGE_BOOTSTRAP_API_KEY ?? null,
    bootstrapScope:
      env.BOS_STORAGE_BOOTSTRAP_ACCOUNT && env.BOS_STORAGE_BOOTSTRAP_GATEWAY
        ? {
            account: env.BOS_STORAGE_BOOTSTRAP_ACCOUNT,
            gateway: env.BOS_STORAGE_BOOTSTRAP_GATEWAY,
          }
        : null,
    requiredPermissions: WRITE_PERMISSIONS,
  };
}

export function validateUploadAuthConfig(
  config: UploadAuthConfig,
  opts: { production: boolean },
): string | null {
  if (config.bootstrapApiKey && !config.bootstrapScope) {
    return "BOS_STORAGE_BOOTSTRAP_ACCOUNT and BOS_STORAGE_BOOTSTRAP_GATEWAY are required when BOS_STORAGE_BOOTSTRAP_API_KEY is set";
  }

  if (!config.authOrigin && !config.bootstrapApiKey && opts.production) {
    return "BOS_STORAGE_AUTH_ORIGIN or BOS_STORAGE_BOOTSTRAP_API_KEY is required in production";
  }

  if (config.authOrigin) {
    try {
      void new URL(config.authOrigin);
    } catch {
      return `BOS_STORAGE_AUTH_ORIGIN is not a valid URL: ${config.authOrigin}`;
    }
  }

  return null;
}

export async function authorizeUploadRequest(input: {
  headers?: Headers;
  account: string;
  gateway: string;
  config: UploadAuthConfig;
  /** which permission family this call needs; bootstrap keys are scoped, not permission-checked */
  permission?: UploadPermission;
  fetchImpl?: typeof fetch;
}): Promise<UploadAuthResult> {
  const requiredPermissions = requiredPermissionsFor(input.permission ?? "write");
  const action = input.permission === "read" ? "inspect" : "deploy";
  const apiKey = input.headers?.get("x-api-key")?.trim() ?? null;
  if (!apiKey) {
    return {
      authorized: false,
      status: "UNAUTHORIZED",
      message: "Authentication required — provide an API key",
      data: { apiKeyProvided: false },
    };
  }

  if (input.config.bootstrapApiKey && apiKey === input.config.bootstrapApiKey) {
    const scope = input.config.bootstrapScope;
    if (!scope || scope.account !== input.account || scope.gateway !== input.gateway) {
      return {
        authorized: false,
        status: "FORBIDDEN",
        message: "Bootstrap API key is not scoped to this deployment target",
        data: {
          requiredPermissions: Object.entries(requiredPermissions).flatMap(
            ([permission, actions]) => actions.map((action) => `${permission}:${action}`),
          ),
          action: `${action} ${input.account}/${input.gateway}`,
        },
      };
    }

    return {
      authorized: true,
      mode: "bootstrap",
      scope,
    };
  }

  if (!input.config.authOrigin) {
    return {
      authorized: false,
      status: "CONNECTION_ERROR",
      message: "BOS_STORAGE_AUTH_ORIGIN is required to verify API keys",
      data: {
        suggestion: "Set BOS_STORAGE_AUTH_ORIGIN or BOS_STORAGE_BOOTSTRAP_API_KEY",
      },
    };
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${input.config.authOrigin}/api/rpc/auth/verifyApiKey`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        json: {
          key: apiKey,
          permissions: requiredPermissions,
        },
      }),
    });
  } catch (error) {
    return {
      authorized: false,
      status: "CONNECTION_ERROR",
      message: `Unable to verify API key: ${error instanceof Error ? error.message : String(error)}`,
      data: { host: input.config.authOrigin },
    };
  }

  if (!response.ok) {
    if (response.status === 401) {
      return {
        authorized: false,
        status: "UNAUTHORIZED",
        message: `Unable to verify API key: auth service responded with ${response.status}`,
        data: {
          apiKeyProvided: true,
          provider: input.config.authOrigin,
          authType: "apiKey",
        },
      };
    }

    return {
      authorized: false,
      status: "CONNECTION_ERROR",
      message: `Unable to verify API key: auth service responded with ${response.status}`,
      data: {
        host: input.config.authOrigin,
        errorCode: String(response.status),
      },
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return {
      authorized: false,
      status: "CONNECTION_ERROR",
      message: "Unable to verify API key: auth service returned invalid JSON",
      data: { host: input.config.authOrigin },
    };
  }

  if (!isRecord(payload)) {
    return {
      authorized: false,
      status: "CONNECTION_ERROR",
      message: "Unable to verify API key: auth service returned an invalid payload",
      data: { host: input.config.authOrigin },
    };
  }

  const result = payload.json;
  if (!isRecord(result) || result.valid !== true) {
    const error = isRecord(result) && isRecord(result.error) ? result.error : null;
    return {
      authorized: false,
      status: "UNAUTHORIZED",
      message: typeof error?.message === "string" ? error.message : "Invalid API key",
      data: {
        apiKeyProvided: true,
        provider: input.config.authOrigin,
        authType: "apiKey",
      },
    };
  }

  const key = result.key;
  if (!isRecord(key)) {
    return {
      authorized: false,
      status: "CONNECTION_ERROR",
      message: "Unable to verify API key: auth service returned no key payload",
      data: { host: input.config.authOrigin },
    };
  }

  const parsedPermissions = parseStringArrayRecord(key.permissions);
  if (!hasRequiredPermissions(parsedPermissions, requiredPermissions)) {
    return {
      authorized: false,
      status: "FORBIDDEN",
      message: "API key is missing bundle permissions",
      data: {
        requiredPermissions: Object.entries(requiredPermissions).flatMap(([permission, actions]) =>
          actions.map((action) => `${permission}:${action}`),
        ),
        action: `${action} bundle`,
      },
    };
  }

  const scope = parseScope(key.metadata);
  if (!scope) {
    return {
      authorized: false,
      status: "FORBIDDEN",
      message: "API key is missing scope metadata",
      data: { action: `${action} bundle` },
    };
  }

  if (scope.account !== input.account || scope.gateway !== input.gateway) {
    return {
      authorized: false,
      status: "FORBIDDEN",
      message: "API key is not scoped to this namespace",
      data: {
        requiredPermissions: Object.entries(requiredPermissions).flatMap(([permission, actions]) =>
          actions.map((permissionAction) => `${permission}:${permissionAction}`),
        ),
        action: `${action} ${input.account}/${input.gateway}`,
      },
    };
  }

  return {
    authorized: true,
    mode: "api-key",
    scope,
    key: {
      id: String(key.id),
      configId: String(key.configId),
      referenceId: String(key.referenceId),
      name: typeof key.name === "string" || key.name === null ? key.name : null,
      metadata: key.metadata,
      permissions: parsedPermissions,
    },
  };
}
