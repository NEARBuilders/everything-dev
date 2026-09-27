import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface SessionCredential {
  kind: "session";
  apiKey: string;
  apiKeyId: string;
  accountId: string | null;
  label: string;
  siteUrl: string;
  createdAt: string;
  expiresAt: string | null;
}

export interface PublishKeyRecord {
  publicKey: string;
  network: "mainnet" | "testnet";
  contract: string;
  exportedTo: string;
}

export interface DelegateKeyRecord {
  publicKey: string;
  privateKey: string;
  accountId: string;
  network: "mainnet" | "testnet";
  contract: string;
  mintedAt: string;
}

export interface BosSessionFile {
  version: 1;
  credential: SessionCredential | null;
  publishKey: PublishKeyRecord | null;
  delegateKey: DelegateKeyRecord | null;
}

const SESSION_FILE_NAME = "session.json";

export function getSessionFilePath(configDir: string): string {
  return join(configDir, ".bos", SESSION_FILE_NAME);
}

export function readSessionHandle(configDir: string): BosSessionFile | null {
  const filePath = getSessionFilePath(configDir);
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as Partial<BosSessionFile>;
    if (parsed.version !== 1) return null;
    return {
      version: 1,
      credential: parsed.credential ?? null,
      publishKey: parsed.publishKey ?? null,
      delegateKey: parsed.delegateKey ?? null,
    };
  } catch {
    return null;
  }
}

export function writeSessionHandle(configDir: string, session: BosSessionFile): void {
  const bosDir = join(configDir, ".bos");
  mkdirSync(bosDir, { recursive: true });
  writeFileSync(getSessionFilePath(configDir), `${JSON.stringify(session, null, 2)}\n`, {
    mode: 0o600,
  });
}

export function updateSessionHandle(
  configDir: string,
  update: (session: BosSessionFile) => BosSessionFile,
): BosSessionFile {
  const current = readSessionHandle(configDir) ?? {
    version: 1 as const,
    credential: null,
    publishKey: null,
    delegateKey: null,
  };
  const next = update(current);
  writeSessionHandle(configDir, next);
  return next;
}

export function deleteSessionHandle(configDir: string): void {
  const filePath = getSessionFilePath(configDir);
  if (existsSync(filePath)) {
    rmSync(filePath);
  }
}

export function nearCredentialsPath(network: "mainnet" | "testnet", account: string): string {
  return join(homedir(), ".near-credentials", network, `${account}.json`);
}

export function removePublishedKeyFile(
  network: "mainnet" | "testnet",
  account: string,
  publicKey: string,
): void {
  const filePath = nearCredentialsPath(network, account);
  if (!existsSync(filePath)) return;
  try {
    const credential = JSON.parse(readFileSync(filePath, "utf-8")) as { public_key?: string };
    if (credential.public_key === publicKey) {
      rmSync(filePath);
    }
  } catch {
    // leave malformed files alone
  }
}
