---
title: "10 · Verification"
description: Why nothing is trusted transitively — the verification spine, the three pin planes, signed manifests, a boot that survives outages, and the supply-chain rules that keep the singleton fleet safe.
order: 100
tags:
  - book
---

# 10 · Verification

The platform's security model is a structure, not a checklist. Every byte a runtime
executes is pinned, every pin is verified against a *different* source, and every
consumer re-verifies the prefix it loads. The result is that "what exactly is
running?" has an answer you can check.

## The spine

Distribution is a chain of attestations — an identity vouching that certain bytes
hash to a certain digest — and each hop is checked on its own:

**chain transaction → config → release record → remote manifest → version directory → file**

| Hop | What is checked before the next one is trusted |
|---|---|
| Transaction → config | The NEAR signature; the config matches what the chain holds |
| Config → release record | The thin tag's digest; the record was written once |
| Record → remote manifest | The manifest's SRI — and its signature, against the key recorded in the config |
| Manifest → file | Every file's sha384, exactly as the manifest records it |

Nothing is inherited along it. A valid config says nothing about a bundle until that
bundle's manifest verifies; a valid manifest says nothing about a file until the
file hashes to the SRI the manifest records.

## Three pin planes

| Plane | Holds | Pinned by | Verified against |
|---|---|---|---|
| Image | Node, dependencies, host and API logic | A digest-pinned base, and a deploy-time digest | The post-publish smoke boots that exact digest |
| Config | The runtime config and its release pointer | An on-chain write, signed by the account key | The NEAR signature; local-versus-chain comparison at boot |
| Bundles | UI and plugin bytes on the CDN | SRI recorded *inside the on-chain config* | The host at load time, the watch loop, the browser |

**One plane is never enough.** A compromised CDN serves bytes that fail SRI. A
hijacked config write needs the account key and is auditable on chain. A compromised
image must survive the digest pin and the smoke gate. Adding an unpinned load path is
a regression against the model. ([ADR 0036](../adr/0036-three-pin-planes.md))

## One verifier

All of this runs through one engine — fetch, hash, compare, fail with a named error —
that returns a **`Verified<T>`** artifact. Consumers accept only verified values, so
unverified bytes cannot flow into composition by accident: the type is the gate. A
chain walker reuses the engine at three depths — `pointer`, `entries`, `files` — and
`bos verify` is the command over the deepest one.
([ADR 0046 — the verification spine](../adr/0046-verification-spine.md))

## Attribution

SRI proves *integrity*: these are the bytes the pin names. It does not prove *who*
published them. **Signed manifests** close that gap: the deploy train signs each
remote's version manifest with the runtime's publish identity, and the verifying key
is recorded inside the on-chain config. A stolen storage credential cannot serve
bytes a reader accepts without either a chain-signed config change or a forgery.
Rotating the key is a config publish — never a silent swap.
([ADR 0046 — manifest attribution](../adr/0046-manifest-attribution.md))

## A boot that does not depend on the registry

Boot is split into two planes:

- The **control plane** produces — the registry, the deploy train, CI — and writes an
  **approved snapshot**: the last composition this host verified, persisted on disk.
- The **application runtime** consumes exactly one input, a verified composition, then
  serves and watches for a newer one.

So the boot sources rank: an explicit config path, then the registry, then the
snapshot. A restart during a registry or CDN outage serves the generation the host
already verified — degraded and visible, never a refusal, and never silently
"current". A host with nothing verified still fails loudly.
([ADR 0041](../adr/0041-boot-snapshot.md),
[ADR 0043](../adr/0043-two-plane-boot.md))

While serving, a pointer watch notices each publish and **adopts** the new generation
only after verification, as an atomic swap. A failed adopt leaves the live snapshot
untouched.

## Drift

State that diverges from a pin is **drift**. Its byte-level form is **rot** — a
served object no longer hashes to its pin; its release-level form is **staleness** —
serving behind the published pointer. Each has a detector:

| Drift | Caught by |
|---|---|
| The lockfile no longer matches a resolution | `bos lock --check` |
| The app is behind the latest release | `bos upgrade --check` |
| A composed remote disagrees on shared singletons | `bos mf check`, then a named boot error |
| Served bytes or attribution differ from the pins | `bos verify`, the smoke gate, the adopt check |

## The supply chain

React and the TanStack stack are shared across every remote, so one bad release would
reach everywhere at once. The rules that prevent it:

- Versions are **pinned in one catalog**; a bump is deliberate.
- Automated updates wait a **minimum release age**, and **minor bumps are never
  auto-merged** — the two shapes a poisoned release most often takes.
- CI installs with **`--ignore-scripts`** and pins every action to a commit SHA.
- A security release has a **fast lane** around the release age: a known patch should
  not wait behind the holdback it exists to enforce. The lane is a recorded policy;
  its automation is not built.

One window is recorded and not closed: network bytes are decompressed before SRI is
checked. A bounded, fail-loud fetch mitigates it.

## Check it

- `bos verify` — walks the spine for a runtime and reports each leg.
- `bos mf check` — every composed remote's shared singletons.
- `bos lock --check`, `bos upgrade --check` — the two drift alarms.

## Further reading

- [How it all fits](../agents/how-it-fits.md) — the spine, drawn, and the runtime's own state surfaces.
- [`SECURITY.md`](../../SECURITY.md) — the policy and the incident-response plan.
- [GLOSSARY.md](../../GLOSSARY.md) — *attestation*, *`Verified<T>`*, *attribution*, *drift*, *digest identity*.
- ADRs [0036](../adr/0036-three-pin-planes.md), [0041](../adr/0041-boot-snapshot.md), [0042](../adr/0042-composition-lockfile.md), [0043](../adr/0043-two-plane-boot.md), and both records numbered [0046](../adr/README.md).
- Next: [11 · Tenancy and direction](11-tenancy-and-direction.md).
