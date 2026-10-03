---
"ui": minor
---

The hand-rolled JSON-RPC view-function wrapper (`ui/src/lib/near-rpc.ts`) is deleted. The stake-pool query call sites read contracts through near-kit (`Near.view`) instead of raw `fetch` against the public RPC endpoints — base64 arg encoding and byte-array result decoding are the library's job now. Failure parity is preserved: unsupported networks, timeouts, and malformed results resolve null and fall into the same clean query error state. Closes #185.
