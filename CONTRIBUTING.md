# Contributing Guide

Thank you for contributing to everything-dev! 🎉

## Join the Community

New here? Get onboarded and plugged in:

1. **Onboard at [nearbuilders.org/join](https://nearbuilders.org/join)** — complete the builder onboarding flow to join NEAR Builders.
2. **Join the Telegram group [@nearbuilderschat](https://t.me/nearbuilderschat)** to discuss, ask questions, and coordinate with other contributors.

> **Note:** This onboarding flow is actively taking recommended improvements. If you spot gaps or have suggestions, share them in the Telegram group, open a PR, and advocate to get it merged.

## Quick Setup

```bash
bun install               # Install dependencies
bun run dev               # Start development (host mode auto-detected)
```

That's it — on first run `bos dev` creates `.env` from `.env.example` (with a generated `BETTER_AUTH_SECRET`), and if local Postgres is down it starts it for you via `docker compose up -d --wait`. Docker must be installed and running.

`bun run dev:postgres` starts the databases explicitly; `dev:postgres:down` / `dev:postgres:reset` manage them. `bun db:migrate` is optional — the API and plugins auto-apply migrations on boot.

Visit http://localhost:3003 (UI), http://localhost:3001 (API), and http://localhost:3002 (Auth).

**Need more details?** See [README.md](./README.md) for architecture overview and [AGENTS.md](./AGENTS.md) for the full operational guide (architecture, dev workflow, plugin architecture, testing, deployment).

## Development Workflow

### Making Changes

- **UI Changes**: Edit `ui/src/` → hot reload automatically
- **API Changes**: Edit `api/src/` → hot reload automatically
- **Plugin Changes**: Edit `plugins/*/src/` → hot reload automatically → deploy per plugin
- **Host Changes**: Edit `host/src/` or the authored config (`bos.app.ts`)

### Plugin Architecture

Business logic lives in independent plugins. A plugin entry in the authored config can be **remote-only** (no `development: local:…` key) — the host/API consume it via `pluginsClient` and HTTP, and types resolve from the deployed manifest. Plugin source does not need to live in this repo.

- **`plugins/registry/`** — Registry/discovery, FastKV app metadata (local in dev)
- **`plugins/_template/`** — Scaffold for new plugins
- **`plugins/auth/`** — Better-Auth, NEAR SIWN, organizations, API keys, passkeys (local)
- **`plugins/proposals/`** — Proposal lifecycle (local)
- **`plugins/votes/`** — Voting feed (local)
- **`plugins/ai/`** — OpenAI-compatible chat (local)

Each plugin has its own `contract.ts`, `index.ts`, and generated rspack config, and `package.json`. Routes are namespaced in the UI: `apiClient.registry.*()`, `apiClient.proposals.*()`, etc.

The `api/` package is a slim shell (ping/error routes + DB layer). It composes across plugins in-process via `createPlugin.withPlugins<PluginsClient>()` — the API receives typed client factories for all other plugins and calls their routers directly without HTTP roundtrips.

Plugin and API variables are configured in the authored config (`bos.app.ts`):
- API variables: `app.api.variables` → `config.variables` in `initialize`
- Plugin variables: `plugins.{key}.variables` → plugin's own `config.variables` in `initialize`

Plugins are accessible both directly via HTTP (`/api/{key}/*`) and in-process via `services.plugins.{key}()`. The UI uses HTTP; the API uses in-process for composition.

### Environment Configuration

All runtime URLs are configured in the authored config - no rebuild needed! Switch environments:

```bash
NODE_ENV=development bos dev  # Use local services (default)
NODE_ENV=production bos dev   # Use production CDN URLs
```

Secrets go in `.env` (see [.env.example](./.env.example) for required variables).

### Project Documentation

- **[AGENTS.md](./AGENTS.md)** - Operational guide for AI agents (and the deepest technical doc in the repo — start here for architecture, workflows, and conventions)
- **[GLOSSARY.md](./GLOSSARY.md)** - Domain vocabulary
- **[README.md](./README.md)** - Architecture, tech stack, and quick start
- **[ui/README.md](./ui/README.md)** - Frontend documentation
- **[host/README.md](./host/README.md)** - Server host documentation

## Git Workflow

### Branch Naming

Create feature branches from `main`:

```bash
git checkout main
git pull origin main
git checkout -b feature/amazing-feature
```

**Branch naming conventions:**
- `feature/description` - New features
- `fix/description` - Bug fixes
- `docs/description` - Documentation changes
- `refactor/description` - Code refactoring
- `test/description` - Test additions/changes

### Semantic Commits

Use [Semantic Commits](https://gist.github.com/joshbuchea/6f47e86d2510bce28f8e7f42ae84c716) for clear history:

```bash
# Format: <type>(<scope>): <subject>
git commit -m "feat(api): add user profile endpoint"
git commit -m "fix(ui): resolve routing issue on mobile"
git commit -m "docs(readme): update setup instructions"
git commit -m "refactor(api): simplify auth middleware"
git commit -m "test(ui): add coverage for login flow"
```

**Types:**
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation only
- `style:` - Code style (formatting, no logic change)
- `refactor:` - Code refactoring
- `perf:` - Performance improvements
- `test:` - Tests
- `chore:` - Build/config/tooling changes

### Changesets

We use [Changesets](https://github.com/changesets/changesets) for versioning.

**When to add a changeset:**
- Any user-facing change (features, fixes, deprecations)
- Breaking changes
- Skip for: docs-only changes, internal refactors, test-only changes

**Create a changeset:**
```bash
bun run changeset
# Follow prompts to select packages and write description
```

**Changeset file format:**
```markdown
---
"api": minor
"ui": patch
---

Added new endpoint for user profiles
```

**The release workflow:**
1. Changesets action creates a "Version Packages" PR on merge to main
2. On merge of that PR, GitHub releases are created for api/ui
3. Deployments happen automatically via CI

### Pull Request Process

1. **Before creating PR:**
   ```bash
   bun run test    # Run all tests
   bun typecheck   # Type check all packages
   bun lint        # Run linting
   ```

2. **Create PR from your fork:**
   - Push branch to your fork: `git push origin feature/amazing-feature`
   - Open PR against `main` branch of upstream repo
   - Use descriptive title following semantic format
   - Fill out PR template if provided

3. **PR requirements:**
   - All tests must pass
   - Type checking must pass
   - Linting must pass
   - Changeset added (if applicable)

4. **After merge:**
   - Delete your branch
   - Changesets action will handle versioning

## Contributing Code

1. **Fork** the repository on GitHub
2. **Clone** your fork locally
3. **Create** a feature branch: `git checkout -b feature/amazing-feature`
4. **Make** your changes
5. **Test** thoroughly: `bun run test` and `bun typecheck`
6. **Add changeset** if needed: `bun run changeset`
7. **Commit** using [Semantic Commits](https://gist.github.com/joshbuchea/6f47e86d2510bce28f8e7f42ae84c716)
8. **Push** to your fork: `git push origin feature/amazing-feature`
9. **Open** a Pull Request to the main repository

### Code Style

- Follow existing TypeScript patterns and conventions
- Ensure type safety (no `any` types unless absolutely necessary)
- Write descriptive commit messages
- Add tests for new features
- Use semantic Tailwind classes (see AGENTS.md for style rules)
- No code comments in implementation (code should be self-documenting)

### Linting

We use [Biome](https://biomejs.dev/) for linting and formatting:

```bash
bun lint        # Check linting
bun lint:fix    # Fix auto-fixable issues
bun format      # Format code
```

## Reporting Issues

Use [GitHub Issues](https://github.com/NEARBuilders/everything-dev/issues) with:

- **Clear description** of the problem
- **Steps to reproduce** the issue
- **Expected behavior** vs **actual behavior**
- **Environment details** (OS, Node/Bun version, browser, etc.)

## Getting Help

- Check [AGENTS.md](./AGENTS.md) for the operational guide and agent conventions
- Check the [README](./README.md) for architecture and setup
- Review workspace READMEs for specific documentation
- Ask questions in GitHub Issues or Discussions

---

Thank you for your contributions! 💚
