import type {
  DualNetworkConfig,
  RelayerDualNetworkConfig,
  SessionGasKeyDualNetworkConfig,
  SubAccountConfig,
} from "better-near-auth";

export type AuthNetwork = "mainnet" | "testnet";

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

export interface AuthConfig {
  secret: string;
  baseUrl: string;
  network?: AuthNetwork;
  organizationMembershipLimit?: number;
  trustedOrigins?: string[];
  isProduction?: boolean;
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
