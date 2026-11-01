import { Data } from "effect";
import type { AppOrchestrator } from "../services/dev/service-descriptor";
import type { RuntimeConfig } from "../types";

export interface CliPorts {
  host?: number;
  api?: number;
  auth?: number;
  ui?: number;
  pluginsStart?: number;
  plugins?: Record<string, { api?: number; ui?: number }>;
}

export interface ResolvedPorts {
  host?: number;
  api?: number;
  auth?: number;
  ui?: number;
  plugins: Record<string, { api?: number; ui?: number }>;
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

export type InfraPhase =
  | "resolve-config"
  | "allocate-services"
  | "claim"
  | "materialize-env"
  | "launch";

export class InfraError extends Data.TaggedError("InfraError")<{
  phase: InfraPhase;
  message: string;
  cause?: unknown;
}> {}

export interface InfraInput {
  configDir: string;
  bosConfig: RuntimeConfig;
  /**
   * The operator-supplied environment (shell exports ∪ `.env`-file values).
   * Conventional database/redis URLs are generated only for `*_DATABASE_URL`/
   * `*_REDIS_URL` secrets the operator did not already supply — an unset
   * operator tier leaves the secret to the consumer's own default (the pglite
   * boot schemas), which is what keeps compose out of the zero-config dev path.
   */
  operatorEnv?: Record<string, string>;
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
