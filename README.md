<!-- markdownlint-disable MD014 -->
<!-- markdownlint-disable MD033 -->
<!-- markdownlint-disable MD041 -->
<!-- markdownlint-disable MD029 -->

<div align="center">

<h1 style="font-size: 4.25rem; font-weight: 800; line-height: 1; margin: 0;">City Nodes</h1>

<img src="ui/src/assets/under-construction.gif" alt="City Nodes" width="380" />

</div>

A decentralized network of NEAR validator nodes organized by geography. Every city, state, and country can run its own validator pool — stake NEAR to keep your city's node online.

## What are City Nodes?

A **City Node** is a NEAR Protocol validator node tied to a real place — a city, state, or country. Each node has its own subdomain (e.g. `chicago.citynode.app`), its own NEAR treasury account, and one or more validator pools that anyone can stake to.

Nodes form a geography tree:

- A **country** node (e.g. USA, Malaysia) sits at the top
- A **state** node (e.g. Illinois) sits under its country
- A **city** node (e.g. Chicago, NYC) sits under its state

A node's **subtree** is itself plus all its descendants. A country page aggregates every validator in its subtree, so stakers can drill from country → state → city.

## The validator pool model

Each node can run **0..N validators**. A validator is a staking target on NEAR with:

- an `account_id` — the NEAR pool account you stake to
- a `protocol` — today: NEAR; extensible to other chains
- a `role` — `official` (run by the node's org) or `community` (run by a local operator)
- an `is_default` flag — the pre-selected validator when you land on a node's stake page

A node with no validators of its own **inherits** from its parent chain. Kuala Lumpur can stake to Malaysia's validator; a brand-new city with no validator yet can stake to its state's or country's.

## How staking works

1. Pick a place — start at the [directory](https://citynode.app) and drill into a country, state, or city.
2. Open the node's stake page (e.g. `chicago.citynode.app/stake`).
3. Sign in with your NEAR wallet.
4. Choose a validator (official or community) and stake NEAR.

Staking helps keep that place's validator online and securing the NEAR network.

## Apply to run a node

Want to set up a node for your city, state, or country? [Apply to run a City Node](https://citynode.app/apply).

## For builders

City Nodes runs on [everything.dev](https://github.com/NEARBuilders/everything-dev) — a Module Federation runtime platform with oRPC contracts, Better-Auth + NEAR SIWN, and an every-plugin API. A fork of this framework exists within this repository, so feel free to make changes to it.

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
