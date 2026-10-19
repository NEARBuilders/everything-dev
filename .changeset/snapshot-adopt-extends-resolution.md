---
"host": patch
"everything-dev": minor
---

SnapshotWatch adopt resolves the published pointer's extends chain; `walkExtendsChain`/`resolveMergedConfigInput` accept a `seedConfig`

- A child runtime's published pointer stores only its own overrides — slots inherited from its parent via `extends` (notably `app.host`) are absent. The adopt transaction built a runtime config straight from the raw pointer, so every adopt crashed with `Cannot read properties of undefined (reading 'production')` and the watch retried forever (backing off to 5 minutes). The adopt now derives the pointer through the same extends-walking pipeline the boot path uses, so inherited slots reach the runtime build and hot swaps work for `extends`-based child runtimes.
- The walk is seeded with the exact pointer bytes the watch fingerprinted (`seedConfig`) — no refetch of the entry itself, and fixture/historical pointers adopt without being published at their own URL. Parent nodes always load normally.
- No fallbacks: a pointer without a `domain` fails the adopt (there is no bos:// ref to resolve — never guess one), and the watch refuses to run against a `everything.dev`-guessed target — a domain-less production boot config disables the watch with a loud error instead of silently polling another runtime's pointer.
- An unresolvable extends chain fails the adopt with a surfaced cause and leaves the live snapshot untouched, per the adopt contract.
