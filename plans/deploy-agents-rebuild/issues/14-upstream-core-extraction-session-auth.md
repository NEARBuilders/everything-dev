# 14: Upstream proposal — core extraction + session-based partner auth

**What to build:** Two PRs (or issues with accepted plans) to NEARFDE/near-intents-agent-api:

1. **Core-package extraction** — extract the framework-free server core (lib + shared)
   into a published core package, so platform consumers take it as a versioned
   dependency instead of vendored copies. The files are already framework-free, so the
   extraction is mechanical upstream.
2. **Session-based partner auth** — Better-Auth sessions as a partner credential
   alongside the static partner API keys, so platform-native consumers authenticate with
   their existing session instead of a distributed key.

Once the core package is published, swap our vendored copies (domain packages + core)
for the dependency — the vendored sources were always the strangler's temporary seam.

**Blocked by:** 13 (ship the plugin + verify the MCP surface).

**Status:** ready-for-agent

- [ ] Core-extraction PR opened upstream (or issue + accepted plan)
- [ ] Session-auth proposal opened upstream, design aligned with their trust model
      (partner key never reaches the browser; sessions inherit that property by construction)
- [ ] After upstream publish: vendored copies replaced by the versioned dependency
- [ ] Upstream decision recorded; follow-up tickets created if the plan changes
