---
"better-near-auth": minor
"@everything-dev/auth-plugin": minor
"ui": patch
---

Upgrade better-auth from 1.6.25 to 1.7.7. The auth plugin's `internalAdapter.createUser` calls now pass the new required provisioning source (`passkey` / `siwn`), and two migrations land for 1.7's schema expectations: `team.member_count` + `team_member.membership_key` (team counters the organization adapter now reads/writes) and the previously missing `funded_gas_key` table (better-near-auth's gas-key ledger, now enforced by 1.7's explicit drizzle schema check). The tsgo client-response type probes stay red-pinned: 1.7.7's response-data inference still collapses to `any` under tsgo 7.0.2.
