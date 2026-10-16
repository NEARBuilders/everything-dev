---
"host": patch
---

SnapshotWatch adopt failures surface their real cause and back off; failed oRPC responses log their route

- The watch's adopt-failure log now walks the full cause chain instead of printing Effect's generic `UnknownError` wrapper message ("An error occurred in Effect.tryPromise") — a deterministically failing adopt is self-diagnosing in production logs.
- Consecutive adopt failures back off exponentially from the watch interval (capped at 5 minutes, reset on any clean/swapped tick) instead of retrying — and logging — every 30 seconds forever.
- Failed oRPC responses (status ≥ 400 through `/api`, `/api/rpc`, or a plugin's RPC route) log one line with the method and pathname, so an error box in the logs can be tied to the route that produced it.
