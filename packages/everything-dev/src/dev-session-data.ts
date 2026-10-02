import type { AppOrchestrator, ServiceDescriptor } from "./service-descriptor";
import type { RuntimeConfig } from "./types";

export interface DevSessionData {
  orchestrator: AppOrchestrator;
  services: Map<string, ServiceDescriptor>;
  runtimeConfig: RuntimeConfig;
  /** The generated infra env tier — required so a start session can never silently run with an empty tier. */
  envGenerated: Record<string, string>;
  shellEnv: Record<string, string>;
}

export interface StartSummary {
  configSource: string;
  configSourceHttp?: string;
  account: string;
  domain?: string;
  modules: { host?: string; ui?: string; api?: string; auth?: string };
  warnings: string[];
}
