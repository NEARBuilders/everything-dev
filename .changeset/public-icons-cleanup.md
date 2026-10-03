---
"ui": patch
"host": patch
---

Clean up ui/public placeholder icons and stale docs.

- Renamed `near.svg` → `icon.svg` and `logo.png` → `icon-512.png` (placeholder dot icons, named for replacement); updated `site.webmanifest` icon srcs.
- Removed dead public files: `README.md` (about route fetches from GitHub raw, not public), `near_rev.svg` (unreferenced), `bos.png` (orphan).
- Rewrote `llms.txt` to follow the standard llms.txt format (H1, blockquote summary, single Skill link).
- Removed `/README.md` from `skill.md` public entry points and raw doc endpoints.
- Updated host integration test `/near.svg` → `/icon.svg`.
