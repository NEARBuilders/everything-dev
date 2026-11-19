---
"better-near-auth": patch
---

Re-pin the Passkey Wallet executor to NEAR-DevHub/near-connect-passkey@798e9e51 and bump the manifest version to 1.0.3 (#901). Trezu rotated the helper key the old executor signed with (pinned at 4974f121 since #621), so every Passkey Wallet submit failed; the new build relays through the helper.trezu.near sponsor contract, signs delegate actions offline with a throwaway key, and upgrades to near-api-ts 0.12. The version bump makes near-connect drop its cached executor; wallet addresses do not change.
