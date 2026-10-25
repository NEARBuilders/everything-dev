# ADR 0037: Sonner as a tolerant UI shared singleton

Date: 2026-10-23
Status: Accepted

Depends on: ADR 0008 (plugin build contract — the rsbuild ui factory), ADR 0036 (three pin planes — shared-singleton trust model), ADR 0034 (platform release manifest).

## Context

Every toast fired from a plugin ui remote was invisible in production. The mounted `<Toaster>` lives in the core ui root (`ui/src/routes/__root.tsx`), bound to the core ui's `sonner` module instance; `sonner` was not in `UI_SHARED_DEPS`, so every plugin remote bundled a private copy — and sonner's toast store is per-module-instance. The auth plugin's sixteen `toast()` call sites (login failures, settings, admin) plus `plugins/ai` wrote into a store nothing rendered. Discovered while debugging a silent login failure during the rc.10/rc.11 shared-singleton skew outage: the failure toast had fired, into the void.

## Decision

1. **Share `sonner` across the ui graph** as a strict-with-exception singleton: `{ name: "sonner", singleton: true, critical: false, resolution: "package" }` in `UI_SHARED_DEPS`. The core ui (provider) and every plugin ui remote (consumer) negotiate the same module instance, so `toast()` calls from remotes render through the core's mounted Toaster. One Toaster stays mounted — sonner duplicates every toast when two observe the same store.

2. **`critical: false` means tolerant, per-entry, in the ui list.** `createUiSharedDeps` now derives from the spec entry: a tolerant entry gets `requiredVersion: false, strictVersion: false` and — unlike critical entries in consumer role — keeps a bundled fallback copy (no `import: false`). The rollout matrix degrades gracefully in every mix:
   - new provider + old remote: the old remote's private copy behaves as today (toasts stay invisible until it rebuilds — no break);
   - old provider + new remote: the remote's bundled fallback serves the import (no negotiation failure, no load error);
   - new provider + new remote: the shared instance — the fix.

3. **Version pinning moves to the catalog** (`sonner: 2.0.8` in `pnpm-workspace.yaml`; `ui`, `plugins/auth`, `plugins/ai` declare `catalog:`) so provider and consumers resolve identical versions and the catalog lockstep rules (Renovate holdback, minor-bumps-manual) apply to it like every shared dependency.

4. **Why not strict.** A strict UI singleton (`requiredVersion: exact, import: false` in consumers) hard-fails a new remote against an old provider — the exact failure class the rc.10/rc.11 skew incident just taught us to fear. Sonner's API surface consumed here (`toast`, `Toaster` props) is stable across 2.x minors, so exact-version pinning buys nothing the catalog pin doesn't already provide. The boot guard (`compareSharedIdentity`) only checks effect-critical core names — a tolerant ui singleton can never trip `SharedSingletonSkewError`.

## Consequences

- Plugin toasts become visible fleet-wide once remotes rebuild against the new spec; until then, old remotes keep today's silent-toast behavior — no coordinated cutover needed, children converge via `bos upgrade`.
- The shared-singleton trust surface grows by one package (ADR 0036's model absorbs it: singleton bytes ship inside SRI-pinned bundles, so a swap is a new signed config publish or a loud SRI failure).
- `sonner` is now load-bearing at the federation layer: a build with sonner unresolvable in the building workspace fails loudly (the shared-deps resolution policy), and removing the Toaster from the core ui root would silently regress every plugin again — treat the core root's Toaster as part of the ui build contract.
- The tolerant-entry mechanism (per-entry `critical: false` in the ui list) is the template for any future UI dependency that must be shared but cannot guarantee provider/remote lockstep.
