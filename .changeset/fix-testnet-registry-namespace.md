---
"everything-dev": patch
"@everything-dev/apps-plugin": patch
---

Fix testnet FastKV registry namespace defaulting to mainnet account

- Testnet namespace was hardcoded to `dev.everything.near` (a mainnet account) instead of `dev.allthethings.testnet`. Publishing to testnet submitted transactions against the wrong contract.
- Remove `REGISTRY_FASTKV_*_NAMESPACE` and `REGISTRY_FASTKV_*_URL` env var overrides — URLs and namespaces are now hardcoded constants.
- Add `--registry` flag to `bos publish`, `bos deploy`, and `bos key generate` to override the FastKV registry contract account at the CLI level.
- Clean up `plugins/apps` RegistryConfigService to drop the env var fallback, relying on the `registryNamespace` bos.config.json variable.
