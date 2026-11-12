---
"every-plugin": patch
---

`createRpcClient` keeps the request's own headers, including `content-type: application/json`, when you pass custom headers such as an API key. Before, they were dropped and the server rejected the input.
