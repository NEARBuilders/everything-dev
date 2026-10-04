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

4. **Update `bos.config.json`** — set `account` to your NEAR account and add `extends` to inherit the base platform:
   ```json
   {
     "extends": "bos://v1.citynode.near/citynode.app",
     "account": "<your-account>.near",
     "domain": "citynode.app"
   }
   ```
   Keep `domain` as `citynode.app` (the gateway). See "Same gateway, own account" below.

5. **Deploy:**
   ```bash
   bos deploy
   # preflight (fail fast on config/signing/storage credentials) → build →
   # upload your workspaces to the base storage (POST /api/storage/bundles,
   # account-pinned) → write bundle URLs at the CDN origin (cdn.everything.dev)
   # → publish bos.config.json to FastKV at bos://<your-account>/citynode.app
   # → build + push the runtime image and deploy it to Railway when configured
   ```
   No CDN provider account — the base runtime stores and serves your bytes; you inherit host/api/auth logic from the base's own bundles. Upload credentials come from `BOS_STORAGE_API_KEY` or a `bos login` session (mint once with `bos login --key`, then put the printed key in GitHub repo secrets as `BOS_STORAGE_API_KEY` for CI; the device-flow session works for interactive deploys). See ADR 0020 for the storage design. (Without a CDN origin the deploy stays image-native and writes gateway URLs — the flip is the `BOS_BUNDLE_CDN_ORIGIN`/`BOS_STORAGE_ORIGIN` env pair.)
   The runtime image leg resolves the image name from `ci.image` in `bos.config.json` → `BOS_IMAGE` env → derived from `repository` (`ghcr.io/<owner>/<repo>`); it only runs when docker is available. The first `bos deploy` populates the R2 bucket for the first time — the committed `cdn.everything.dev` bundle URLs become true only once that run completes.

6. **Run the universal image** — pull `ghcr.io/nearbuilders/everything-dev` (Railway: one-click template or `railway up`; the deploy train deploys the pushed SHA tag). No image build of your own — ever. Set these environment variables on your instance:
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
