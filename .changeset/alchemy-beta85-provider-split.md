---
"everything-dev": minor
---

Bump Alchemy to `2.0.0-beta.85` (npm `latest`) and Effect to `4.1.4` in lockstep. Alchemy's provider split (beta.84) moved Docker out of the monolith, so the hosting adapter now imports `@alchemy.run/docker` — declared as a new optional peer (`>=2.0.0-beta.85 <3.0.0`) alongside the tightened `alchemy` peer range (`>=2.0.0-beta.85 <3.0.0`, was `>=2.0.0-beta.79 <3.0.0`: the split means code written for beta.85 cannot run on older alchemy). The `effect` peer and the `@effect/platform-node`/`@effect/platform-node-shared` dependencies move to `4.1.4` because alchemy beta.85 imports `effect/dist/crypto/Digest.js`, which only Effect 4.1 ships. No behavioral change to the Docker hosting seam: same `Alchemy.Stack` per instance, same `Deploy.deploy` plan/apply semantics against the `@alchemy.run/docker` provider.
