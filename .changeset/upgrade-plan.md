---
"everything-dev": minor
---

`bos upgrade` shows its plan before writing — per-file consent instead of refuse-or-force (#844)

On a TTY, `bos upgrade` now stops and shows what it is about to do before doing it:

- **The version plan**: resolved release, package deltas (`from → to`), changelog link.
- **The file plan**: every file the sync will write — template updates, new files, and conflicts (labeled "local edits — template wins (backup kept)") — as a multi-select, **defaulting to overwrite all**: space toggles, enter confirms.
- **Write?** — nothing lands until the confirm. Cancelling leaves the tree untouched.
- **Post-upgrade clean** (default on): runs `bos clean` after a successful upgrade with the sync/import backups preserved — they are the review surface for the files just overwritten. Surfaced as a note in the result.

Under the hood:

- `bos sync`/`upgradeTemplate` gain `overwrite: string[]` — the approved write set. When present it is an exhaustive filter over updated/added/conflicted: selected files are written (backed up), deselected conflicts are preserved (never an abort), and a preserved file **keeps its old baseline** — so the skip never launders a local fork into the new normal: the next upgrade re-asks (the three-way comparison conflicts again when the template has moved), instead of today's silent template-win.
- The selection rides the train's re-exec boundary (`--overwrite a,b,c` to the migration child), so the migration phase's sync applies the same approved set.
- `--force` keeps its meaning (overwrite everything, no prompts) and non-TTY runs (CI, scripts) keep the classic refuse-on-conflict behavior. The preflight abort names the interactive plan as the remedy.
- `--overwrite a,b,c` also works hand-written; `--clean-after` runs the post-step non-interactively.
