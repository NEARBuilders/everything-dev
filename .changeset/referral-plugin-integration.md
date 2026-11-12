---
"better-near-auth": minor
---

Add user referrals via @marinedotsh/better-auth-referral. Every user gets a referral code; signup links (/login?ref=CODE) attribute wallet, passkey, and email signups to the referrer. New "Referrals" settings tab shows the code, invite link, stats, and referred users. Configurable through the auth variables referral block (maskReferredUserEmail, steps); better-near-auth's signIn.near now forwards fetchOptions (used for the referral header).
