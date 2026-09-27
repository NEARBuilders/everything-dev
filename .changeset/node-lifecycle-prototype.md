---
"ui": minor
"host": patch
"@everything-dev/apps-plugin": patch
---

Rework the node lifecycle prototype at `/prototype-staking-poc` into a signer-aware clock with twelve ordered stations: apply, approve, publish the tenant, lock the endowment's NEAR, stake the pool from its lockup, stake the team's own NEAR, register the team wallet in veNEAR, assign the endowment's delegation, vote in House of Stake, unstake the pool, take the vote back, and unstake the team's stake. Each station declares its signer, so when the Trezu treasury changes between acts the row prompts you to connect before it can sign; one click runs everything the connected role can sign. DAO-signed actions are routed through the cycle as sputnik-dao proposals. Approving a staged proposal now always goes through the connected Trezu wallet — a mismatched treasury is disconnected and reconnected as the proposal's DAO before the vote is signed — and a station only reads done once none of its proposals still await votes; skipped stations say why. The admin "node applications" cleanup panel is gone.

Tenant URLs across the dashboard, the public node page, the directory, the registry detail, and the prototype now build through a single dev-aware helper that resolves `<label>.localhost` against the host's binding resolver in development and `https://<label>.<gateway>` in production. The host's binding resolver now maps `<label>.localhost` onto the gateway alias when NODE_ENV is not production, so dev clicks on tenant links land on the right tenant instead of the base runtime. The server-side `buildOpenUrl` in the apps plugin refuses to fabricate a public URL for `*.localhost`/loopback hosts.
