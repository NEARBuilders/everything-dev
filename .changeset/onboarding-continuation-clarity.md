---
"@everything-dev/auth-plugin": minor
---

Onboarding continuation fixes: redeeming an invitation link now activates the invite's organization even when the member already redeemed it before, the link-onboarding page skips the display-name step for returning members who already chose a name, the done panel points at a new `/build` page holding the two copy-prompt cards (NEAR AI private inference, NEAR Intents), and the "Continue on your computer" card points at a direct `/login?method=phone` deep link with concrete scan-and-approve instructions plus a copy-link action. The login page honors `?method=phone` by opening the pairing QR immediately (desktop only — mobile falls back to the sign-in view).
