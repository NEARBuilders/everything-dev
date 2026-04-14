declare const ConfigError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "ConfigError";
} & Readonly<A>;
export declare class ConfigError extends ConfigError_base<{
    readonly path?: string;
    readonly cause?: unknown;
}> {
}
declare const DatabaseError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "DatabaseError";
} & Readonly<A>;
export declare class DatabaseError extends DatabaseError_base<{
    readonly cause?: unknown;
}> {
}
declare const FederationError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "FederationError";
} & Readonly<A>;
export declare class FederationError extends FederationError_base<{
    readonly remoteName: string;
    readonly remoteUrl?: string;
    readonly cause?: unknown;
}> {
}
declare const PluginError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "PluginError";
} & Readonly<A>;
export declare class PluginError extends PluginError_base<{
    readonly pluginName?: string;
    readonly pluginUrl?: string;
    readonly cause?: unknown;
}> {
}
declare const ServerError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "ServerError";
} & Readonly<A>;
export declare class ServerError extends ServerError_base<{
    readonly cause?: unknown;
}> {
}
export {};
