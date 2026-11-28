# everything-dev

A consolidated product package for building Module Federation apps with oRPC APIs.

## Subpath Exports

- `everything-dev/types` - Zod schemas and TypeScript types
- `everything-dev/config` - Config loading and resolution
- `everything-dev/shared` - Shared dependency policy generation
- `everything-dev/federation` - Module Federation runtime utilities
- `everything-dev/api` - API plugin loading and router stitching
- `everything-dev/host` - Host server orchestration

### Adding a public export

The public surface is guarded by `tests/unit/public-surface.test.ts`: no entry may be an `export *` barrel (re-export shims use explicit named lists with `//` section comments, in the shape of `src/db/index.ts`), and the per-entry symbol snapshot must be regenerated (`pnpm vitest run tests/unit/public-surface.test.ts -u`) in the same PR as the export change, so every interface change is a visible diff. Before adding a symbol to an entry, name its consumer — internal-only helpers stay module-internal (importable by relative path inside the package, just not re-exported), and symbols consumed only by this package's tests should generally not be public at all. The guard prints an advisory warning for symbols with zero references outside their defining module; emitted child-repo code (descriptor/serialize.ts, scaffold steps, every-plugin stubs) counts as a consumer.

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
  └── everything-dev/federation (load UI remote via MF)
```

## MF Manifest Standard

All remotes (UI + API) use `mf-manifest.json` as the standard entry point:

- `ui.entry = <uiBaseUrl>/mf-manifest.json`
- `api.entry = <apiBaseUrl>/mf-manifest.json`

This ensures consistent remote loading across Node SSR and browser environments.
