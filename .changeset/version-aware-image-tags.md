---
"everything-dev": minor
---

Version-aware runtime image tags: `bos deploy` now pushes the exact `v<version>` tag (and a floating `v<major>` tag on stable releases) alongside `sha-<short>`. `:latest` is held while the workspace version is a prerelease — the Docker analog of the npm `rc` dist-tag — so deployments pulling `:latest` keep serving the last stable image until a stable release moves it.
