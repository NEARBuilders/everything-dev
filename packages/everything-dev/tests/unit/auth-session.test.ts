import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type BosSessionFile,
  deleteSessionHandle,
  getSessionFilePath,
  nearCredentialsPath,
  readSessionHandle,
  removePublishedKeyFile,
  updateSessionHandle,
  writeSessionHandle,
} from "../../src/auth-session";

describe("auth-session", () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "bos-session-"));
  });

  afterEach(() => {
    const filePath = getSessionFilePath(configDir);
    if (existsSync(filePath)) {
      deleteSessionHandle(configDir);
    }
  });

  it("returns null when no session file exists", () => {
    expect(readSessionHandle(configDir)).toBeNull();
  });

  it("writes and reads back a session file with restricted permissions", () => {
    const session: BosSessionFile = {
      version: 1,
      credential: {
        kind: "session",
        apiKey: "api_test",
        apiKeyId: "key-1",
        accountId: "dev.everything.near",
        label: "test",
        siteUrl: "http://localhost:3003",
        createdAt: new Date().toISOString(),
        expiresAt: null,
      },
      publishKey: null,
      delegateKey: null,
    };

    writeSessionHandle(configDir, session);

    const filePath = getSessionFilePath(configDir);
    expect(existsSync(filePath)).toBe(true);
    expect(JSON.parse(readFileSync(filePath, "utf-8"))).toMatchObject(session);
    expect(readSessionHandle(configDir)).toEqual(session);
  });

  it("updateSessionHandle merges into the existing file", () => {
    writeSessionHandle(configDir, {
      version: 1,
      credential: null,
      publishKey: null,
      delegateKey: null,
    });

    updateSessionHandle(configDir, (current) => ({
      ...current,
      publishKey: {
        publicKey: "ed25519:abc",
        network: "mainnet",
        contract: "dev.everything.near",
        exportedTo: "/tmp/keys/ed25519:abc.json",
      },
    }));

    const stored = readSessionHandle(configDir);
    expect(stored?.publishKey?.publicKey).toBe("ed25519:abc");
    expect(stored?.credential).toBeNull();
  });

  it("ignores unreadable or malformed session files", () => {
    mkdirSync(join(configDir, ".bos"), { recursive: true });
    writeFileSync(getSessionFilePath(configDir), "not json");
    expect(readSessionHandle(configDir)).toBeNull();
  });

  it("deleteSessionHandle removes the file", () => {
    writeSessionHandle(configDir, {
      version: 1,
      credential: null,
      publishKey: null,
      delegateKey: null,
    });
    deleteSessionHandle(configDir);
    expect(readSessionHandle(configDir)).toBeNull();
  });

  describe("removePublishedKeyFile", () => {
    it("removes the credentials file only when the public key matches", () => {
      const network = "testnet" as const;
      const account = "demo.testnet";
      const target = nearCredentialsPath(network, account);
      mkdirSync(target.slice(0, target.lastIndexOf("/")), { recursive: true });
      const original = JSON.stringify({
        account_id: account,
        public_key: "ed25519:abc",
        private_key: "ed25519:seed",
      });
      writeFileSync(target, original);

      removePublishedKeyFile(network, account, "ed25519:other");
      expect(existsSync(target)).toBe(true);

      removePublishedKeyFile(network, account, "ed25519:abc");
      expect(existsSync(target)).toBe(false);
    });
  });
});
