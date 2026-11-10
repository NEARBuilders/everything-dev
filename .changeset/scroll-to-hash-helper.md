---
"everything-dev": minor
---

Ship `useScrollToHash` from the `everything-dev/ui` surface: a ref-setter hook that scrolls to a section once it mounts while the current location hash matches its id, closing the gap where hash links like `/dashboard/node#payouts` never scroll because the router's hash scroll runs once on navigation, before the target section renders from a client query (#820). Pass the bare hash id (no `#`); the hook scrolls once per hash visit, ignores other hashes, and re-scrolls when the hash returns after leaving — child apps carrying local copies of this helper can import the framework one and delete their own.
