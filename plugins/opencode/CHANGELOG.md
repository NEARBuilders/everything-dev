# @everything-dev/opencode-plugin

## 1.1.0

### Minor Changes

- 8e378e3: New opencode plugin for AI coding assistant integration

  - Opencode-specific routes and contract definitions
  - Runtime config hot-swap support

### Patch Changes

- 96a492e: Add SRI integrity hashes to plugin deployments

  Plugin rspack configs now compute SHA-384 integrity hashes on deploy and write `productionIntegrity` to `bos.config.json`, matching the existing behavior of `api`, `ui`, and `host` packages.
