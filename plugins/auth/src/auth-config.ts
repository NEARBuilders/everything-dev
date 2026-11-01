import type {
  DualNetworkConfig,
  RelayerDualNetworkConfig,
  SessionGasKeyDualNetworkConfig,
  SubAccountConfig,
} from "better-near-auth";

export type AuthNetwork = "mainnet" | "testnet";

export interface AuthPermissionStatements {
  statements: Record<string, string[]>;
  roles: Record<string, Record<string, string[]>>;
}

export interface AuthPasskeyConfig {
  rpID?: string;
  rpName?: string;
  origin?: string;
  gatewayOrigins?: Partial<Record<AuthNetwork, string[]>>;
}

export interface AuthSiwnBaseConfig {
  apiKey?: string;
  rpcUrl?: string;
  relayer?: RelayerDualNetworkConfig;
  sessionGasKey?: SessionGasKeyDualNetworkConfig;
  subAccount?: SubAccountConfig | DualNetworkConfig<SubAccountConfig>;
  permissions: AuthPermissionStatements;
}

export interface AuthSiwnRecipientConfig extends AuthSiwnBaseConfig {
  recipient: string;
  recipients?: never;
}

export interface AuthSiwnRecipientsConfig extends AuthSiwnBaseConfig {
  recipient?: never;
  recipients: {
    mainnet: string;
    testnet: string;
  };
}

export type AuthSiwnConfig = AuthSiwnRecipientConfig | AuthSiwnRecipientsConfig;

export interface AuthReferralConfig {
  maskReferredUserEmail?: boolean;
  steps?: string[];
}

/** Rate limiting behind proxies/multi-replica deployments (#688). `window` is
 * seconds; `storage: "database"` persists buckets in the plugin's rateLimit
 * table so limits hold across replicas. */
export interface AuthRateLimitConfig {
  enabled?: boolean;
  window?: number;
  max?: number;
  storage?: "memory" | "database";
}

/** Client-IP resolution for rate limiting (#688, trust boundary #338):
 * `ipAddressHeaders` names a single header the proxy overwrites (e.g.
 * `cf-connecting-ip`); `trustedProxies` opts into forwarded-chain walking —
 * list your proxies' own addresses, never a range that also covers clients. */
export interface AuthIpAddressConfig {
  ipAddressHeaders?: string[];
  trustedProxies?: string[];
}

export interface AuthConfig {
  secret: string;
  baseUrl: string;
  network?: AuthNetwork;
  organizationMembershipLimit?: number;
  trustedOrigins?: string[];
  isProduction?: boolean;
  rateLimit?: AuthRateLimitConfig;
  ipAddress?: AuthIpAddressConfig;
  referral?: AuthReferralConfig;
  socialProviders?: {
    github?: {
      clientId?: string;
      clientSecret?: string;
    };
    google?: {
      clientId?: string;
      clientSecret?: string;
    };
  };
  passkey?: AuthPasskeyConfig;
  deviceLink?: {
    clientId: string;
  };
  phoneNumber?: {
    twilio?: {
      accountSid: string;
      authToken: string;
      phoneNumber: string;
    };
  };
  siwn: AuthSiwnConfig;
  email?: {
    from: string;
  };
}
