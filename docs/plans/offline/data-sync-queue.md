# Layer 2: Offline Data Sync — Request Queue & Replay

## Summary

Provide infrastructure for queuing API requests when offline and replaying them when connectivity returns. This is harder to make fully generic than Layer 1 because the SW doesn't understand the API's business logic, but the host can provide the queue storage and replay mechanism without knowing API specifics.

## Architecture

```
┌───────────────────────────────────────┐
│              Service Worker            │
│                                       │
│  ┌─────────┐    ┌──────────────────┐  │
│  │ Network  │    │  IndexedDB Queue │  │
│  │ Monitor  │    │  [req1, req2...] │  │
│  └────┬─────┘    └────────┬─────────┘  │
│       │                   │            │
│  ┌────▼───────────────────▼─────────┐  │
│  │        Message Channel           │  │
│  │  postMessage({ type, payload })  │  │
│  └──────────────┬───────────────────┘  │
└─────────────────┼──────────────────────┘
                  │
┌─────────────────▼──────────────────────┐
│              UI (React)                │
│                                       │
│  useOfflineQueue() hook               │
│  useOnlineStatus() hook               │
│  OfflineBanner component              │
└───────────────────────────────────────┘
```

The SW stores queued requests in IndexedDB. It communicates with the UI via `postMessage`. On reconnect, it replays the queue.

## SW side

### `host/src/sw.ts` additions (~80 lines)

```typescript
// IndexedDB schema: { id, url, method, headers, body, timestamp, retries }

const DB_NAME = 'offline-queue';
const DB_VERSION = 1;
const STORE_NAME = 'requests';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeInQueue(entry: { url: string; method: string; headers: Record<string, string>; body?: string }) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).add({ ...entry, timestamp: Date.now(), retries: 0 });
}

async function getQueue(): Promise<Array<{ id: number; url: string; method: string; headers: Record<string, string>; body?: string; retries: number }>> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  return new Promise((resolve) => {
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result);
  });
}

async function getQueueStatus() {
  const queue = await getQueue();
  return { queued: queue.length, oldestTimestamp: queue[0]?.timestamp || null };
}

async function removeFromQueue(id: number) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).delete(id);
}

// Listen for queued requests from the UI
self.addEventListener('message', (e) => {
  if (e.data?.type === 'QUEUE_REQUEST') {
    storeInQueue(e.data.payload);
  }
  if (e.data?.type === 'GET_QUEUE_STATUS') {
    getQueueStatus().then(status => {
      e.ports?.[0]?.postMessage(status);
    });
  }
});

// When back online, replay the queue
self.addEventListener('sync', (e) => {
  if (e.tag === 'api-queue') {
    e.waitUntil(replayQueue());
  }
});

async function replayQueue() {
  const queue = await getQueue();
  for (const entry of queue) {
    try {
      const response = await fetch(entry.url, {
        method: entry.method,
        headers: entry.headers,
        body: entry.body,
      });
      if (response.ok) {
        await removeFromQueue(entry.id);
        // Notify UI of successful sync
        const clients = await self.clients.matchAll();
        clients.forEach(client => {
          client.postMessage({ type: 'SYNC_RESULT', id: entry.id, success: true });
        });
      }
    } catch {
      // Leave in queue, retry next sync event
    }
  }
}

// Register for background sync when online
self.addEventListener('online', () => {
  // @ts-expect-error — BackgroundSync not in SW types
  self.registration.sync?.register('api-queue');
});
```

## Host side

### `host/src/services/sw-registration.ts` additions

```typescript
export function getSwRegistrationScript(): string {
  return `
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', async () => {
        const reg = await navigator.serviceWorker.register('/sw.js');

        // Handle updates
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          newWorker?.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New version available — UI can show update prompt
              window.dispatchEvent(new CustomEvent('sw-update-available'));
            }
          });
        });
      });
    }
  `;
}
```

## UI side (optional hooks — NOT provided by the host)

These would live in the UI package or as a shared library. The SW infrastructure is ready to be consumed via `postMessage`:

```typescript
// UI app can optionally implement:
function useOnlineStatus() {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('online', cb);
      window.addEventListener('offline', cb);
      return () => {
        window.removeEventListener('online', cb);
        window.removeEventListener('offline', cb);
      };
    },
    () => navigator.onLine,
  );
}

function useOfflineQueue() {
  // Communicate with SW via postMessage:
  // - Queue a request:   sw.postMessage({ type: 'QUEUE_REQUEST', payload: {...} })
  // - Get queue status:  sw.postMessage({ type: 'GET_QUEUE_STATUS' })
  // - Get sync results:  sw.addEventListener('message', handler)
}
```

## What the host provides generically

| Thing | Generic? | How |
|-------|----------|-----|
| SW registration | Yes | Injects `<script>` into shell |
| Cache-first for assets | Yes | URL pattern matching in SW |
| Network monitor | Yes | `navigator.onLine` + `online`/`offline` events |
| Request queue storage | Yes | IndexedDB, schema: `{ url, method, headers, body, timestamp, retries }` |
| Queue replay on reconnect | Yes | Background Sync API or periodic check |
| Queue status query | Yes | `postMessage` channel |
| Expose to UI | Yes | SW message channel is protocol-agnostic |

## What cannot be generic

| Thing | Why |
|-------|-----|
| Conflict resolution | Depends on the API's business logic |
| Dependent mutations | "Create X, then use X.id to create Y" — needs app-level orchestration |
| Optimistic UI updates | App must handle stale state gracefully |
| Partial sync | Deciding which mutations to replay first |
| Idempotency guarantees | Some POST calls shouldn't replay; app must flag these |

These are the app developer's responsibility. The host provides the queue — the app decides what to put in it and how to handle replay results.

## Dependencies on Layer 1

This layer assumes Layer 1 (Offline Shell) is implemented. The SW file (`host/src/sw.ts`) is shared between both layers — Layer 1 adds asset caching, Layer 2 adds queue infrastructure to the same file.

## Implementation order

1. **Layer 1** — ~150 lines across 4 files. The entire app shell works offline after first visit. No UI changes needed.
2. **Layer 2** — ~100 more lines in the SW + SW registration. The queue infrastructure exists. UI packages can optionally consume it via hooks.

Layer 1 is self-contained and delivers the offline shell. Layer 2 builds on it.
