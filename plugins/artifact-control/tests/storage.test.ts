import { describe, expect, it } from "vitest";
import {
  createStorageLayerFromEnv,
  resolveStorageConfigFromEnv,
} from "../src/storage";

describe("artifact-control storage", () => {
  it("reads a complete storage config from env", () => {
    const config = resolveStorageConfigFromEnv({
      BOS_STORAGE_ENDPOINT: "https://example.r2.cloudflarestorage.com",
      BOS_STORAGE_BUCKET: "artifact-control",
      BOS_STORAGE_ACCESS_KEY_ID: "access-key",
      BOS_STORAGE_SECRET_ACCESS_KEY: "secret-key",
      BOS_STORAGE_REGION: "auto",
    });

    expect(config).toEqual({
      endpoint: "https://example.r2.cloudflarestorage.com",
      bucket: "artifact-control",
      accessKeyId: "access-key",
      secretAccessKey: "secret-key",
      region: "auto",
    });
  });

  it("returns null when production storage config is missing", () => {
    expect(resolveStorageConfigFromEnv({})).toBeNull();
    expect(createStorageLayerFromEnv({}, { allowMemory: false })).toBeNull();
  });
});
