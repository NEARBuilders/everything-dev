import { ORPCError } from "@orpc/server";
import { describe, expect, it } from "vitest";
import {
  classifyPluginFailure,
  ModuleFederationError,
  PluginRuntimeError,
  toPluginRuntimeError,
  ValidationError,
} from "../../src/runtime/errors";

describe("Error Handling Utilities", () => {
  describe("toPluginRuntimeError", () => {
    it("should extract message from Error instance", () => {
      const error = new Error("Test error message");
      const result = toPluginRuntimeError(error, "test-plugin");

      expect(result).toBeInstanceOf(PluginRuntimeError);
      expect(result.cause?.message).toBe("Test error message");
    });

    it("should extract from nested cause", () => {
      const rootCause = new Error("Root cause");
      const wrapper = new Error("Wrapper error", { cause: rootCause });
      const result = toPluginRuntimeError(wrapper, "test-plugin");

      expect(result.cause?.message).toContain("Wrapper error");
    });

    it("should handle AggregateError", () => {
      const errors = [new Error("Error 1"), new Error("Error 2"), new Error("Error 3")];
      const aggregateError = new AggregateError(errors, "Multiple errors occurred");
      const result = toPluginRuntimeError(aggregateError, "test-plugin");

      expect(result).toBeInstanceOf(PluginRuntimeError);
      expect(result.cause).toBeDefined();
    });

    it("should handle plain objects with message property", () => {
      const plainError = { message: "Plain object error" };
      const result = toPluginRuntimeError(plainError, "test-plugin");

      expect(result).toBeInstanceOf(PluginRuntimeError);
      expect(result.cause?.message).toBe("Plain object error");
    });

    it("should stringify unknown types", () => {
      const unknownError = 42;
      const result = toPluginRuntimeError(unknownError, "test-plugin");

      expect(result).toBeInstanceOf(PluginRuntimeError);
      expect(result.cause?.message).toBe("42");
    });

    it("should handle null and undefined", () => {
      const nullResult = toPluginRuntimeError(null, "test-plugin");
      expect(nullResult).toBeInstanceOf(PluginRuntimeError);

      const undefinedResult = toPluginRuntimeError(undefined, "test-plugin");
      expect(undefinedResult).toBeInstanceOf(PluginRuntimeError);
    });

    it("should pass through existing PluginRuntimeError", () => {
      const existingError = new PluginRuntimeError({
        pluginId: "original-plugin",
        operation: "original-operation",
        cause: new Error("Original cause"),
      });

      const result = toPluginRuntimeError(existingError, "new-plugin");

      expect(result).toBe(existingError);
      expect(result.pluginId).toBe("original-plugin");
    });

    it("should convert unknown errors with metadata", () => {
      const error = new Error("Unknown error");
      const result = toPluginRuntimeError(error, "test-plugin", "testProc", "test-op");

      expect(result).toBeInstanceOf(PluginRuntimeError);
      expect(result.pluginId).toBe("test-plugin");
      expect(result.procedureName).toBe("testProc");
      expect(result.operation).toBe("test-op");
      expect(result.cause).toBe(error);
    });
  });

  describe("classifyPluginFailure", () => {
    it("classifies ModuleFederationError through cause chains and suggests bos mf check", () => {
      const mfError = new ModuleFederationError({
        pluginId: "auth-ui",
        remoteUrl: "https://cdn.example.com/auth",
        cause: new Error("Container not found"),
      });
      const wrapper = new PluginRuntimeError({
        pluginId: "auth-ui",
        cause: mfError,
      });

      const result = classifyPluginFailure(wrapper);
      expect(result.kind).toBe("mf");
      expect(result.retryable).toBe(false);
      expect(result.suggestion).toContain("bos mf check");
    });

    it("classifies transient network failures as retryable", () => {
      for (const message of [
        "ETIMEDOUT: Connection timed out",
        "ECONNRESET: Connection reset by peer",
        "Service returned 503 Service Unavailable",
        "429 Too Many Requests",
        "Request timeout exceeded",
      ]) {
        const result = classifyPluginFailure(new Error(message));
        expect(result.kind).toBe("network");
        expect(result.retryable).toBe(true);
      }
    });

    it("classifies dead network failures as non-retryable with a config hint", () => {
      for (const message of ["ECONNREFUSED: Connection refused", "ENOTFOUND: Host not found"]) {
        const result = classifyPluginFailure(new Error(message));
        expect(result.kind).toBe("network");
        expect(result.retryable).toBe(false);
        expect(result.suggestion).toContain("bos.config.json");
      }
    });

    it("classifies integrity mismatches", () => {
      const result = classifyPluginFailure(new Error("SRI hash mismatch: integrity failure"));
      expect(result.kind).toBe("integrity");
      expect(result.retryable).toBe(true);
      expect(result.suggestion).toContain("redeploy");
    });

    it("classifies validation errors with stage and plugin", () => {
      const zodError = new (class extends Error {
        issues = [{ path: ["name"], message: "required" }];
      })("Invalid input");
      const error = new ValidationError({
        pluginId: "votes",
        stage: "input",
        zodError: zodError as never,
      });

      const result = classifyPluginFailure(error);
      expect(result.kind).toBe("validation");
      expect(result.retryable).toBe(false);
      expect(result.message).toContain("input");
      expect(result.suggestion).toContain("plugins/votes");
    });

    it("classifies oRPC code errors as unknown kind with their message", () => {
      const orpcError = new ORPCError("TOO_MANY_REQUESTS", { message: "Rate limit exceeded" });
      const wrapped = toPluginRuntimeError(orpcError, "test-plugin", "proc", "op");

      const result = classifyPluginFailure(wrapped);
      expect(result.kind).toBe("network");
      expect(result.retryable).toBe(true);
    });

    it("falls back to unknown without suggestions", () => {
      const result = classifyPluginFailure(new Error("Something exploded"));
      expect(result.kind).toBe("unknown");
      expect(result.retryable).toBe(false);
      expect(result.suggestion).toBeUndefined();
    });
  });
});
