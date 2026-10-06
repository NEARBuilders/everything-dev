---
name: talk-to-the-app
description: Work a running everything.dev app over its API without cloning it — MCP tools, REST/OpenAPI, oRPC RPC, plugin RPC, API-key authentication, and discovery endpoints. Use when an agent needs to read or write app data (registry, proposals, votes, auth session, AI chat) over HTTP, choose between MCP/REST/RPC surfaces, or debug authentication and refused calls.
metadata:
  sources: "host/src/routes/api.ts,host/src/services/mcp.ts,ui/public/skill.md,plugins/registry/src/contract.ts,plugins/proposals/src/contract.ts,plugins/votes/src/contract.ts,plugins/ai/src/contract.ts,api/src/contract.ts"
---

# Talk to the app

You act against a **running everything.dev instance** — no clone, no build.
Every operation in the app's API is reachable four ways; they differ only in
transport. The data is identical.

## Read this page, then choose a surface

| The task in front of you | Use |
|---|---|
| An MCP client (Claude, Cursor, …) drives the whole API | [MCP](#mcp) |
| A script or curl one-off — GET/POST against documented paths | [REST](#rest-openapi) |
| A typed JSON-RPC call by procedure name | [oRPC RPC](#orpc-rpc) |
| Anything else: rate limits, auth failures, which surface failed | this file |

**Load the skill for the task in front of you; do not load them all.**

## Facts every call relies on

| | local dev | production |
|---|---|---|
| API base | `http://localhost:3001` | the app's origin (`/api/*` is same-origin) |
| REST path | `<api-base>/api/<path>` | `<origin>/api/<path>` |
| oRPC RPC | `<api-base>/api/rpc/...` | `<origin>/api/rpc/...` |
| MCP | `POST <api-base>/api/mcp` | `POST <origin>/api/mcp` |
| Auth header | `x-api-key: api_...` | same |

There is no network parameter anywhere — the origin is the choice.

## Authentication

All API operations require authentication. Use an **API key**:

1. Sign in with your NEAR wallet (SIWN) at the app.
2. Navigate to **Settings → API Keys** at `/settings/api-keys`.
3. Create a new key — the full secret (`api_...`) is shown once, copy it immediately.
4. Pass it on every request:

```
x-api-key: api_your_key_here
```

The header works for `/api/*` (REST), `/api/rpc/*` (oRPC RPC), and `/api/mcp`
(MCP). Keys carry optional permissions; a call outside them refuses with 403.

## MCP

Streamable HTTP, stateless — no session ID required:

```
POST /api/mcp
```

Connect your MCP client to `<origin>/api/mcp`. Tools are auto-generated from
the API's OpenAPI spec, so every API operation — including auth, relay, and
API-key management — appears as a typed tool. Discovery:

```
GET /.well-known/mcp.json
```

Returns the server name, endpoint URL, and auth scheme.

## REST / OpenAPI

- **API docs UI**: `GET /api` (Scalar reference)
- **OpenAPI spec**: `GET /api/spec.json`
- REST paths are the contract paths under `/api`:

| operation | path |
|---|---|
| health | `GET /api/ping` |
| published registry apps | `GET /api/v1/registry/apps` |
| one registry app | `GET /api/v1/registry/apps/{accountId}/{gatewayId}` |
| registry status | `GET /api/v1/registry/status` |
| proposals lifecycle | `POST /api/v1/proposals`, `.../approve`, `.../reject`, `.../reopen` |
| upvotes | `POST /api/v1/upvotes`, `GET /api/v1/upvotes/{entityId}/count` |
| AI chat | `POST /api/v1/chat` (streaming) |

## oRPC RPC

Typed JSON-RPC by procedure name, one mount per plugin:

```
POST /api/rpc/{plugin}/{procedure}
Content-Type: application/json

["input-or-array"]
```

- `POST /api/rpc/ping` — the API shell (mounted at the root)
- `POST /api/rpc/registry/listRegistryApps` — registry plugin
- `POST /api/rpc/auth/getSession` — auth plugin (special-cased mount)
- AI chat streaming lives at `POST /api/rpc/ai/chat`

## The tasks you will actually be given

**"What can this app do?"** Read `GET /api/spec.json` — it is the full typed
surface, and the MCP tools are generated from exactly it.

**"List the published apps."** `GET /api/v1/registry/apps` (or the
`listRegistryApps` MCP tool). Paginate with `limit`.

**"Check my identity / session."** `POST /api/rpc/auth/getSession` with the key.
An empty session means the key's owner has no active browser session — keys
identify the user, they do not create sessions.

**"Vote on / read the voting feed."** Counts and reads via
`/api/v1/upvotes/*`; casting needs the session of a signed-in user or a key
with write permission.

## Rules to work by

- **Read before writing.** `GET /api/spec.json` first; every write route names
  its auth requirement in the spec.
- **A key is not a session.** `x-api-key` identifies an owner; sign-in flows
  (`better-near-auth#client`) create sessions. Use the key for agent work.
- **One failed call is information.** See below before retrying.

## What comes back when it refuses

| status | do |
|---|---|
| `401` | no or bad key — re-read `/settings/api-keys`; check the `x-api-key` header reached the request |
| `403` | the key lacks permission — the owner edits the key's permissions; do not retry unchanged |
| `404` | wrong surface or path — re-check `/api/spec.json`; plugin RPC mounts are `/api/rpc/<pluginKey>` |
| `429` | rate limited — wait as the response says, then once more |
| `5xx` | repeat later; on a write it may have been made — read first to confirm |

A refused write changes nothing: verify by reading, then repeat only if
nothing is there.
