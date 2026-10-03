<!-- markdownlint-disable MD014 -->
<!-- markdownlint-disable MD033 -->
<!-- markdownlint-disable MD041 -->
<!-- markdownlint-disable MD029 -->

<div align="center">

<h1 style="font-size: 4.25rem; font-weight: 800; line-height: 1; margin: 0;">everything.dev</h1>

<img src="ui/src/assets/under-construction.gif" alt="everything.dev" width="380" />

</div>

The open runtime for apps on NEAR — compose published plugins, own your runtime config, and extend the platform with your own deployments.

## What is everything.dev?

everything.dev is a **Module Federation runtime platform**:

- a shared **host** that boots from a published runtime config (authored in `bos.app.ts`, published on-chain to the FastKV registry)
- an **every-plugin** framework — oRPC contracts, Effect services, plugin manifests
- **Better-Auth + NEAR SIWN** for sign-in, with passkeys, API keys, and organizations
- a **CLI** (`bos`) for dev, builds, publishing, and deploys

Apps are composed at runtime: a child runtime `extends` the base platform, overrides the slots it cares about (UI, plugins), and deploys its own instance — no forks, no host rebuilds.

## For builders

This repository is the **base runtime** and the source of truth for the published packages (`everything-dev`, `every-plugin`, `better-near-auth`) and the universal runtime image.

Scaffold your own app on the platform:

```bash
bos init your-app.everything.dev \
  --extends dev.everything.near/everything.dev \
  --account your-account.near \
  --overrides ui \
  --no-interactive
```

## Deploy

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/everything-dev-template?referralCode=MuB_vg&utm_medium=integration&utm_source=template&utm_campaign=generic)

The Railway template deploys the everything.dev Docker image. You'll need to provide:

| Variable | Description | Example |
|----------|-------------|---------|
| `BOS_ACCOUNT` | The NEAR account that owns this app's published configuration on-chain — it signs `bos publish` transactions and namespaces the FastKV registry | `myapp.near` |
| `BOS_GATEWAY` | The core domain where this app is served — combined with `BOS_ACCOUNT`, it forms the registry lookup path `bos://<account>/<gateway>` | `myapp.com` |
| `BETTER_AUTH_SECRET` | Secret used for session encryption and key derivation — generate with `openssl rand -base64 32` | (random) |

## License

MIT
