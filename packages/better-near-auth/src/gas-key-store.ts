import type { PrivateKey } from "near-kit";
import type { NearNetwork } from "./store.js";

export type StoredGasKey = {
  privateKey: PrivateKey;
  publicKey: string;
};

const DB_NAME = "better-near-auth-gas-keys";
const STORE_NAME = "keys";

function openKeyDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB unavailable"));
  });
}

function storageKey(networkId: string, accountId: string): string {
  return `${networkId}:${accountId}`;
}

export async function saveSessionGasKey(
  networkId: NearNetwork,
  accountId: string,
  key: StoredGasKey,
): Promise<void> {
  const db = await openKeyDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(key, storageKey(networkId, accountId));
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to store session gas key"));
    };
  });
}

export async function loadSessionGasKey(
  networkId: NearNetwork,
  accountId: string,
): Promise<StoredGasKey | null> {
  const db = await openKeyDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(storageKey(networkId, accountId));
    tx.oncomplete = () => {
      db.close();
      resolve((request.result as StoredGasKey | undefined) ?? null);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to load session gas key"));
    };
  });
}

export async function deleteSessionGasKey(
  networkId: NearNetwork,
  accountId: string,
): Promise<void> {
  const db = await openKeyDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(storageKey(networkId, accountId));
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to delete session gas key"));
    };
  });
}
