# everything-dev

A consolidated product package for building Module Federation apps with oRPC APIs.

## Subpath Exports

- `everything-dev/types` - Zod schemas and TypeScript types
- `everything-dev/config` - Config loading and resolution
- `everything-dev/shared` - Shared dependency policy generation
- `everything-dev/mf` - Module Federation runtime utilities
- `everything-dev/plugin` - Plugin authoring (re-exports from every-plugin)
- `everything-dev/api` - API plugin loading and router stitching
- `everything-dev/host` - Host server orchestration
- `everything-dev/cli` - CLI entry point and plugin workspace commands

### Plugin commands

- `bos plugin add <source>` - attach local or remote plugins
- `bos plugin remove <key>` - detach a plugin
- `bos plugin list` - list configured plugins
- `bos plugin publish <key>` - publish one plugin package

## Quick Start

```bash
# Build the package
cd packages/everything-dev
npm run build

# Start the dev server from the project root
bos dev
```

## Architecture

```
bos.config.json
  ↓
everything-dev/config (load + resolve)
  ↓
everything-dev/shared (generate shared deps policy)
  ↓
everything-dev/host (orchestrate)
  ├── everything-dev/api (load API plugins via MF)
  └── everything-dev/mf (load UI remote via MF)
```

## MF Manifest Standard

All remotes (UI + API) use `mf-manifest.json` as the standard entry point:

- `ui.entry = <uiBaseUrl>/mf-manifest.json`
- `api.entry = <apiBaseUrl>/mf-manifest.json`

This ensures consistent remote loading across Node SSR and browser environments.
