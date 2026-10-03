---
"everything-dev": patch
---

Fix fresh-clone dev flow: commit docker-compose.yml, boot CLI from source, drop postinstall.

- Commit `docker-compose.yml` (was gitignored and generated only after preflight, creating a chicken-and-egg where `bun run dev` exited before the file was written). Provisions `postgres-api` (5432/api_db) and `postgres-auth` (5433/auth_db); plugins isolate via `plugin_<pluginId>` schemas sharing `api_db`.
- Add `paths` to `packages/everything-dev/tsconfig.json` mapping `every-plugin` and subpath exports to source files so bun's runtime resolver finds them without pre-built dist. Fresh clones no longer need a manual `bun run --cwd packages/every-plugin build` before `bun run dev`.
- Remove `postinstall: "bun run types:gen"` from root `package.json` — it was already dead code (`bunfig.toml` sets `ignore-scripts = true`). Gen files are produced on-demand by `bos dev`, `bos build`, and `bun typecheck`.
- Update `AGENTS.md` Quick Reference to include `docker compose up -d --wait` and document the plugin schema isolation model.
