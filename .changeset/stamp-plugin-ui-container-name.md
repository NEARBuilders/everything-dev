---
"everything-dev": patch
---

Publish stamps the built MF container name into folder-form plugin ui slots (`app.<id>.ui.name` / `plugins.<id>.ui.name`) so fully-remote boots register the remote under the name the deployed container actually exposes. Previously the config carried only the authored fallback name (e.g. `auth-ui`), which broke SSR compose against CDN bundles built as `_everything_dev_auth_plugin`.
