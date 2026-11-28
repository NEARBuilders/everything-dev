---
"every-plugin": minor
---

The ui rsbuild factory's web-only builds never delete the built SSR
container (`dist/ssr`) anymore (#940): when the node environment is
excluded (a dev-shape train build without `BOS_SSR`), rsbuild's dist
clean keeps the `ssr` subtree via `cleanDistPath.keep`, so a
`pnpm run build` from a plain shell can no longer wipe the container a
running `dev:ssr` stack serves. Builds that include the node environment
(deploy trains, dev-session SSR builds) clean and re-emit it as before.
