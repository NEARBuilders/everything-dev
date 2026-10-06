---
"everything-dev": patch
---

Build errors are visible again in `bos dev`. Rsbuild prints `error   Build error:` on stderr and the actual detail (`File: …`, `× …`) on stdout; the log pipeline now joins those detail lines onto the header as one error event and treats bundler `×` lines as errors on any stream, so the live tail and shutdown summary show the cause instead of a bare header. CLI commands also stop reporting "Unknown error" for Effect tagged errors (e.g. `ArtifactGenError` from `bos typecheck` / `bos types gen`): the tag, phase and cause chain are now shown.
