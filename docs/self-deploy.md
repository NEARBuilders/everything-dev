# Self-Deployed Production

Run your own host instance on your own NEAR account while inheriting the base platform via `extends`. The architecture supports independent self-deployment: publish your own config on-chain and point your own host at it, without waiting on this repo's CI/CD. See AGENTS.md → "Self-Deployed Development" for the tier model and the local-dev path.

## Step-by-step

1. **Install near-cli-rs** (needed for account management and `bos key generate`; `bos publish` signs via near-kit, falling back to the near-cli-rs OS keychain for local interactive use):
   ```bash
   curl --proto '=https' --tlsv1.2 -LsSf https://github.com/near/near-cli-rs/releases/download/v0.23.5/near-cli-rs-installer.sh | sh
   near --version    # verify
   ```

2. **Create a NEAR account** via near-cli-rs (testnet for experimentation, mainnet for production). Named accounts (e.g. `myorg.near`) can own subaccounts; implicit hex accounts cannot:
   ```bash
   near account create-account fund-my-account <your-account>.testnet use-faucet network-config testnet
   # or for mainnet, fund via a wallet transfer
   ```

3. **Generate a publish access key** — a function-call key scoped to the FastKV registry contract (`__fastdata_kv` on `dev.everything.near`). This is the key that signs `bos publish` transactions:
   ```bash
   bos key generate
   # Output includes: NEAR_PRIVATE_KEY=ed25519:...
   ```
   Add the key to your account via near-cli-rs (interactive keychain signing). Then set `NEAR_PRIVATE_KEY` in your `.env` or CI secrets.

4. **Update the authored config** (`bos.app.ts`; legacy `bos.config.json` also works) — set `account` to your NEAR account and add `extends` to inherit the base platform:
   ```json
   {
     "extends": "bos://v1.citynode.near/citynode.app",
     "account": "<your-account>.near",
     "domain": "citynode.app"
   }
   ```
   Keep `domain` as `citynode.app` (the gateway). See "Same gateway, own account" below. Optionally pin the framework release your repo tracks — `"platform": "2.0.0-rc.14"` (ADR 0034); absent means latest via `extends`, and `bos upgrade --check` is the manual drift alarm.

5. **Deploy:**
    ```bash
    bos deploy
    # preflight (fail fast on config/signing/storage credentials) → build →
    # upload your workspaces to the base storage (POST /api/storage/bundles,
    # account-pinned) → write bundle URLs at the CDN origin (cdn.everything.dev)
    # → publish bos.config.json to FastKV at bos://<your-account>/citynode.app
    # → build + push the runtime image and deploy it to Railway when configured
    ```
    `upload.everything.dev` is the write/control service; `cdn.everything.dev` is the read-only CDN origin. Production deploys must set `BOS_STORAGE_ENDPOINT`, `BOS_STORAGE_BUCKET`, `BOS_STORAGE_ACCESS_KEY_ID`, `BOS_STORAGE_SECRET_ACCESS_KEY`, and `BOS_STORAGE_AUTH_ORIGIN` so the upload service can verify API keys against the base auth service. For first deploys or break-glass runs, you can also set `BOS_STORAGE_BOOTSTRAP_API_KEY` with `BOS_STORAGE_BOOTSTRAP_ACCOUNT` and `BOS_STORAGE_BOOTSTRAP_GATEWAY` instead of the auth origin. See ADR 0020 for the storage design. Without a CDN origin an upload-planned deploy hard-errors (`BOS_BUNDLE_CDN_ORIGIN`/`BOS_STORAGE_ORIGIN` env pair, or the authored `cdn.origin` — a gateway-origin upload is refused).
    The runtime image leg resolves the image name from `BOS_IMAGE` env → derived from `repository` (`ghcr.io/<owner>/<repo>`); it only runs when docker is available. Child runtimes never build — their image ref derives from the platform release manifest (`platform` pin, ADR 0034) and the Railway leg repoints the service source to it. The first `bos deploy` populates the R2 bucket for the first time — the committed `cdn.everything.dev` bundle URLs become true only once that run completes.

6. **Run the universal image** — pull `ghcr.io/nearbuilders/everything-dev`. The service is **image-backed**: connect the source once via `railway service source connect --image ghcr.io/nearbuilders/everything-dev:rc --service app` — no build happens on Railway. On every subsequent `bos deploy`, the train runs `railway redeploy --from-source`, which pulls whatever the connected ref points at — for a child runtime this is just a reload trigger serving your freshly published config. Tag reference: `:rc` tracks the prerelease train head (moves on every prerelease deploy, freezes once a stable ships) — use it unless you want to pin; `:latest` serves the last stable release; `sha-<short>` is byte-exact, one per deploy; `v<version>` moves with every deploy while that version is live (`main` runs ahead of the version between release-PR merges) and freezes at that version's *last* deploy — which can sit ahead of the npm release commit — so treat it as "last train state of that release", not a byte-frozen release ref. Which framework release your **repo** tracks is the authored config's `platform` pin (ADR 0034 — the field is absent by default: latest via `extends`; `bos upgrade` moves it, and everything from the upgrade catalog to the compat checks derives from that one pin). No image build of your own — ever. Set a healthcheck on the service (`/health`, ~300s timeout) and these environment variables on your instance:
   | Variable | Value |
   |----------|-------|
   | `BOS_ACCOUNT` | `<your-account>.near` |
   | `BOS_GATEWAY` | `citynode.app` |
   | `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |

7. **Your instance boots** `bos start`, fetches your published config from FastKV at `bos://<your-account>/citynode.app`, loads host/api/auth logic from the base's bundles (stale-if-error cached under `BOS_BUNDLE_CACHE_DIR`), and serves your version live at the Railway-assigned URL. Changes take minutes, not hours.

## Same gateway, own account

`BOS_GATEWAY` (`domain` in `bos.config.json`) is the **FastKV lookup key**, not the DNS domain your Railway instance serves on. By keeping `BOS_GATEWAY=citynode.app` while using your own `BOS_ACCOUNT`, your config lives at a separate FastKV path (`bos://<your-account>/citynode.app`) that `extends` the base runtime (`bos://v1.citynode.near/citynode.app`). You inherit the full platform — host, API, auth, plugins — and override only what you change. Your Railway URL is the ingress; point your own domain's DNS at it if you want a custom domain.

## near-cli-rs quick reference

| Command | Purpose |
|---------|---------|
| `near account create-account fund-my-account <id> ...` | Create a new NEAR account |
| `near account list-keys <id> network-config <net> now` | List access keys on an account |
| `near account add-key <id> grant-function-call-access ...` | Add a function-call access key (used by `bos key generate`) |
| `near account delete-keys <id> public-keys <keys> ...` | Remove access keys |
| `near account export-account <id> explicitly-provide-private-key ...` | Export a full access key |
| `near contract call-function as-transaction <contract> <method> ...` | Submit a contract call (used internally by `bos key generate`; `bos publish` signs in-process via near-kit) |

The `bos` CLI wraps near-cli-rs for account and key management — you normally don't invoke `near` directly except for account creation and key export. `bos publish` signs its transaction in-process via near-kit; `bos key generate` handles publish-key minting.
