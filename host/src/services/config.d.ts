import { Context } from "every-plugin/effect";
import type { ClientRuntimeConfig, RuntimeConfig, SharedConfig, SourceMode } from "everything-dev/types";
export type { ClientRuntimeConfig, RuntimeConfig, SharedConfig, SourceMode };
declare const ConfigService_base: Context.TagClass<ConfigService, "host/ConfigService", {
    env: "production" | "development";
    account: string;
    networkId: "mainnet" | "testnet";
    hostUrl: string;
    ui: {
        name: string;
        url: string;
        entry: string;
        source: "local" | "remote";
        localPath?: string | undefined;
        port?: number | undefined;
        ssrUrl?: string | undefined;
    };
    api: {
        name: string;
        url: string;
        entry: string;
        source: "local" | "remote";
        localPath?: string | undefined;
        port?: number | undefined;
        proxy?: string | undefined;
        variables?: Record<string, string> | undefined;
        secrets?: string[] | undefined;
    };
    domain?: string | undefined;
    title?: string | undefined;
    repository?: string | undefined;
    shared?: {
        ui?: Record<string, {
            version: string;
            requiredVersion?: string | undefined;
            singleton?: boolean | undefined;
            eager?: boolean | undefined;
            strictVersion?: boolean | undefined;
            shareScope?: string | undefined;
        }> | undefined;
    } | undefined;
    plugins?: Record<string, {
        name: string;
        url: string;
        entry: string;
        source: "local" | "remote";
        localPath?: string | undefined;
        port?: number | undefined;
        proxy?: string | undefined;
        variables?: Record<string, string> | undefined;
        secrets?: string[] | undefined;
    }> | undefined;
}>;
export declare class ConfigService extends ConfigService_base {
}
