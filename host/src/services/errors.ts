import { Data } from "effect";

export class ExposeModuleMissing extends Data.TaggedError("ExposeModuleMissing")<{
  readonly expose: string;
  readonly reason: "not-found" | "no-default";
}> {
  override get message() {
    return this.reason === "not-found"
      ? `Module not found: ${this.expose}`
      : `${this.expose} has no default export`;
  }
}

export class FederationError extends Data.TaggedError("FederationError")<{
  readonly remoteName: string;
  readonly remoteUrl?: string;
  readonly detail?: string;
  readonly cause?: unknown;
}> {
  override get message() {
    if (this.detail) return this.detail;
    const raw = this.cause instanceof FederationError ? this.cause.cause : this.cause;
    const detail = raw instanceof Error ? raw.message : String(raw ?? "");
    return `Failed to load ${this.remoteName}${this.remoteUrl ? ` from ${this.remoteUrl}` : ""}: ${detail}`;
  }
}

export class PluginError extends Data.TaggedError("PluginError")<{
  readonly pluginName?: string;
  readonly pluginUrl?: string;
  readonly cause?: unknown;
}> {
  override get message() {
    const raw = this.cause instanceof PluginError ? this.cause.cause : this.cause;
    const detail = raw instanceof Error ? raw.message : String(raw ?? "");
    return `Plugin ${this.pluginName ?? "unknown"}${this.pluginUrl ? ` at ${this.pluginUrl}` : ""} failed: ${detail}`;
  }
}

export class HostServerError extends Data.TaggedError("HostServerError")<{
  readonly cause: unknown;
}> {
  override get message() {
    return `Host server failed: ${this.cause instanceof Error ? this.cause.message : String(this.cause)}`;
  }
}

export class UiComposeError extends Data.TaggedError("UiComposeError")<{
  readonly operation: string;
  readonly cause: unknown;
}> {
  override get message() {
    const detail = this.cause instanceof Error ? this.cause.message : String(this.cause);
    return `${this.operation}: ${detail}`;
  }
}
