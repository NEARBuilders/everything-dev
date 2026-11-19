# Self-Deployed Production

Run your own host instance on your own NEAR account while inheriting the base platform via `extends`. The architecture supports independent self-deployment: publish your own config on-chain and point your own host at it, without waiting on this repo's CI/CD. See AGENTS.md → "Self-Deployed Development" for the tier model and the local-dev path.

## Step-by-step

1. **Update the authored config** (`bos.app.ts`; legacy `bos.config.json` also works) — set `account` to your NEAR account and add `extends` to inherit the base platform:
   ```json
   {
     "extends": "bos://v1.citynode.near/citynode.app",
     "account": "<your-account>.near",
     "domain": "citynode.app"
   }
   ```
   Keep `domain` as `citynode.app` (the gateway). The `cdn` block (`cdn.origin` / `cdn.upload`) is inherited from the base runtime via `extends` — set it only if you run your own CDN/upload stack. Optionally pin the framework release your repo tracks — `"platform": "2.0.0-rc.14"` (ADR 0034); absent means latest via `extends`, and `bos upgrade --check` is the manual drift alarm.

2. **Deploy** — no env vars, no near-cli-rs:
   ```bash
   bos login
   ```
   One browser trip: sign in with your NEAR wallet and approve. The approval (a) mints a scoped deploy key (`bundles:write`, limited to your config's account + gateway) used for uploads, and (b) has your wallet add a **function-call key scoped to the registry's `__fastdata_kv` method** (1 NEAR allowance) to your account. That key's private half lives in `.bos/session.json` (gitignored, 0600) — it can publish your config and nothing else, and the platform relayer pays the gas. Re-running `bos login` keeps the existing key. Then:
   ```bash
   bos deploy
   ```
   The train: preflight (fail fast on config/signing/storage credentials) → build → upload your workspaces to the platform upload service (`cdn.upload`, account-pinned) → write bundle URLs at the CDN origin (`cdn.origin`) → publish `bos.app.ts` to FastKV at `bos://<your-account>/citynode.app` → build + push the runtime image and deploy it to Railway when configured. Any browser approval a deploy still needs happens up front, before the build.

   `bos login` targets the root of your `extends` chain (where the platform auth service lives); pass `--site <url>` to override it or to log in against a local stack.

   Signing mode resolves in this order — explicit beats implicit:
   | Order | Mode | When |
   |-------|------|------|
   | 1 | **Key** | `--private-key` |
   | 2 | **As configured** | `publish.auth` in the authored config: `"key"`, `"session"`, or `"custody"` |
   | 3 | **Key** | a key is already available (`NEAR_PRIVATE_KEY` / `BOS_NEAR_PRIVATE_KEY` or `~/.near-credentials`) — existing setups keep working |
   | 4 | **Session** | a login session exists for the config's account — the default for a fresh `bos login` |

   A session without a NEAR wallet (passkey/social login) cannot install the publish key; deploy with a key or `publish.auth: "custody"` instead. An underfunded custody wallet fails preflight in seconds with the funding link, not after a full build.

3. **Run the universal image** — pull `ghcr.io/nearbuilders/everything-dev`. The service is **image-backed**: connect the source once via `railway service source connect --image ghcr.io/nearbuilders/everything-dev:rc --service app` — no build happens on Railway. On every subsequent `bos deploy`, the train runs `railway redeploy --from-source`, which pulls whatever the connected ref points at — for a child runtime this is just a reload trigger serving your freshly published config. Tag reference: `:rc` tracks the prerelease train head (moves on every prerelease deploy, freezes once a stable ships) — use it unless you want to pin; `:latest` serves the last stable release; `sha-<short>` is byte-exact, one per deploy; `v<version>` moves with every deploy while that version is live (`main` runs ahead of the version between release-PR merges) and freezes at that version's *last* deploy — which can sit ahead of the npm release commit — so treat it as "last train state of that release", not a byte-frozen release ref. Which framework release your **repo** tracks is the authored config's `platform` pin (ADR 0034 — the field is absent by default: latest via `extends`; `bos upgrade` moves it, and everything from the upgrade catalog to the compat checks derives from that one pin). No image build of your own — ever. Set a healthcheck on the service (`/health`, ~300s timeout) and these environment variables on your instance:
   | Variable | Value |
   |----------|-------|
   | `BOS_ACCOUNT` | `<your-account>.near` |
   | `BOS_GATEWAY` | `citynode.app` |
   | `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |

4. **Your instance boots** `bos start`, fetches your published config from FastKV at `bos://<your-account>/citynode.app`, loads host/api/auth logic from the base's bundles (stale-if-error cached under `BOS_BUNDLE_CACHE_DIR`), and serves your version live at the Railway-assigned URL. Changes take minutes, not hours.

5. **Rate limiting** — the host limits `/api/*` per client (default 2000 requests / 15 min, plus a stricter 60/15-min bucket for non-exempt mutations). Tune with `RATE_LIMIT_MAX` and `RATE_LIMIT_WINDOW_MS` on your instance (mutation tier: `RATE_LIMIT_MUTATION_MAX`). `GET /api/auth/get-session` is exempt from the general bucket — a 429 must never present as "signed out" (#634). People behind one IP (offices, conference wifi) share a bucket; raise the limit if that's your audience.

## CI (headless)

CI has no browser, so key signing is the path — the only place `NEAR_PRIVATE_KEY` is still needed:

```yaml
env:
  NEAR_PRIVATE_KEY: ${{ secrets.NEAR_PRIVATE_KEY }}   # function-call key on your account, __fastdata_kv scope
  BOS_STORAGE_API_KEY: ${{ secrets.BOS_STORAGE_API_KEY }} # the deploy key from `bos login` (printed once; also in .bos/session.json)
```

`bos key generate` mints the publish key; add it to your account via near-cli-rs (interactive keychain signing on a dev machine). Alternatively set `publish.auth: "key"` in the authored config to make key signing the explicit default regardless of a session's presence. The upload service's env vars (`BOS_STORAGE_ORIGIN`, `BOS_BUNDLE_CDN_ORIGIN`) are only overrides — the authored `cdn.origin`/`cdn.upload` and the platform defaults cover everything else. `BOS_STORAGE_AUTH_ORIGIN` is an upload-server-only setting — never needed in a deployer's environment.

## Custody path

`bos login --custody` registers an OutLayer custody wallet (TEE-held keys, one per user and network) alongside the CLI session. The wallet's implicit hex account is your deploy's machine identity:

- set the authored config's `account` to the custody wallet account (`bos deploy` preflight fails with the exact repair hint on mismatch),
- fund the wallet — the deploy preflight checks the gas balance and fails before the build with the funding link (`app.outlayer.ai/wallet/fund?to=<account>`),
- the FastKV write is submitted through OutLayer's coordinator; a chain-side revert still counts as submitted (ADR 0001) and the FastKV read-back stays the authoritative check.

The custody wallet is best for agent-owned runtimes where no human wallet is around to sign. The session (browser-signed delegate) mode is the default human path.

## Same gateway, own account

`BOS_GATEWAY` (`domain` in `bos.app.ts`) is the **FastKV lookup key**, not the DNS domain your Railway instance serves on. By keeping `BOS_GATEWAY=citynode.app` while using your own `BOS_ACCOUNT`, your config lives at a separate FastKV path (`bos://<your-account>/citynode.app`) that `extends` the base runtime (`bos://v1.citynode.near/citynode.app`). You inherit the full platform — host, API, auth, plugins — and override only what you change. Your Railway URL is the ingress; point your own domain's DNS at it if you want a custom domain.

## near-cli-rs quick reference

near-cli-rs is only needed for account management — account creation and CI key setup. Interactive deploys never touch it.

| Command | Purpose |
|---------|---------|
| `near account create-account fund-my-account <id> ...` | Create a new NEAR account |
| `near account list-keys <id> network-config <net> now` | List access keys on an account |
| `near account add-key <id> grant-function-call-access ...` | Add a function-call access key (used by `bos key generate`) |
| `near account delete-keys <id> public-keys <keys> ...` | Remove access keys |
| `near account export-account <id> explicitly-provide-private-key ...` | Export a full access key |

The `bos` CLI wraps near-cli-rs for account and key management — you normally don't invoke `near` directly except for account creation and CI key export.
