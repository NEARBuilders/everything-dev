---
"host": minor
---

Add MCP (Model Context Protocol) server endpoint at `/api/mcp`. Auto-generates tools from the API's OpenAPI spec, proxying to existing oRPC routes in-process. Supports API key and session auth. Uses `@modelcontextprotocol/server` + `@modelcontextprotocol/hono` v2 with stateless Streamable HTTP transport.
