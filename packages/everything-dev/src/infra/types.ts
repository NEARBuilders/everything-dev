import { Data } from "effect";
import type { AppOrchestrator } from "../service-descriptor";
import type { InfraConfig, RuntimeConfig } from "../types";

export interface CliPorts {
  host?: number;
  api?: number;
  auth?: number;
  ui?: number;
  uiSsr?: number;
  pluginsStart?: number;
  plugins?: Record<string, { api?: number; ui?: number }>;
}

export interface ResolvedPorts {
  host?: number;
  api?: number;
  auth?: number;
  ui?: number;
  uiSsr?: number;
  plugins: Record<string, { api?: number; ui?: number }>;
  postgres: Record<string, number>;
  redis: Record<string, number>;
}

export interface RuntimeLaunchSpec {
  port?: number;
  hostUrl?: string;
  corsOrigin?: string;
  trustedOrigins?: string[];
  env: Record<string, string>;
  runtimeConfig: RuntimeConfig;
}

export interface ClaimRecord {
  resourceKey: string;
  pid: number;
  configDir: string;
  ports: Record<string, number>;
  startedAt: number;
}

export interface InfraPlan {
  workspaceKey: string;
  cliPorts: CliPorts;
  resolvedPorts: ResolvedPorts;
  runtimeConfig: RuntimeConfig;
  launch: RuntimeLaunchSpec;
  description: string;
  serviceDescriptors: Map<string, ServiceDescriptorPlan>;
  envGenerated: Record<string, string>;
  composeModel: ComposeModelPlan;
  claims: ClaimRecord[];
  orchestrator: AppOrchestrator;
}

export interface ServiceDescriptorPlan {
  key: string;
  source: "local" | "remote";
  url: string;
  port?: number;
  localPath?: string;
}

export interface ComposeModelPlan {
  databases: DatabasePlan[];
  redis: RedisPlan[];
}

export interface DatabasePlan {
  secret: string;
  slug: string;
  port: number;
  dbName: string;
  containerName: string;
  volumeName: string;
  url: string;
}

export interface RedisPlan {
  secret: string;
  slug: string;
  port: number;
  containerName: string;
  volumeName: string;
  url: string;
}

export type InfraPhase =
  | "resolve-config"
  | "allocate-services"
  | "allocate-databases"
  | "claim"
  | "materialize-env"
  | "materialize-compose"
  | "launch";

export class InfraError extends Data.TaggedError("InfraError")<{
  phase: InfraPhase;
  message: string;
  cause?: unknown;
}> {}

export interface InfraInput {
  configDir: string;
  bosConfig: RuntimeConfig;
  infraConfig?: InfraConfig;
  cli: {
    port?: number;
    apiPort?: number;
    authPort?: number;
    uiPort?: number;
    pluginPortStart?: number;
    plugins?: Record<string, { api?: number; ui?: number }>;
    ssr?: boolean;
    proxy?: boolean;
    hostSource?: "local" | "remote";
    uiSource?: "local" | "remote";
    apiSource?: "local" | "remote";
    authSource?: "local" | "remote";
    interactive?: boolean;
  };
}
