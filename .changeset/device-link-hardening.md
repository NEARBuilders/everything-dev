---
"@everything-dev/auth-plugin": minor
"everything-dev": patch
---

Harden Device Link sign-in from phone to desktop:

- The device token endpoint now records a single-use claim for the session token it issues (stored hashed, bound to the client id, ~60s expiry). `/device-link/claim` now requires `client_id`, sets the cookie only for an unconsumed, unexpired claim issued to that client, and consumes it; arbitrary session tokens are refused. `bos login` sends its client id with the claim.
- Device code requests are accepted only from the configured `deviceLink.clientId` and the bos CLI (`bos-cli`); any other client id is rejected.
- The desktop session starts in the organization the member most recently joined.
- The login redirect sanitizer allows the device approval path, so a signed-out phone signs in and returns to approval with its `user_code`; login redirects now navigate by `href` so query strings survive.
- After a Device Link sign-in the desktop offers "add a passkey on this device"; dismissal is remembered per device.
- The onboarding success screen replaces "Set up your NEAR wallet" with a "Continue on your computer" step pointing at the Gateway Origin.
