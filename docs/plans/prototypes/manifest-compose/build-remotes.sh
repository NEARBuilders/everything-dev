#!/usr/bin/env bash
# Canonical remote build order for the manifest-compose prototype.
# WEB build first, NODE (SSR) build LAST — rsbuild cleans its output dir on
# every build, so a node build after a web build keeps both dist/remoteEntry.js
# and dist/ssr/remoteEntry.server.js. A node build BEFORE a web build loses ssr.
#
# usage: bash build-remotes.sh [--with-guard]
#   --with-guard  also builds remote-auth's guard variant (mismatched react
#                 requiredVersion → dist-bad) for the GUARD_ENTRY probe
set -euo pipefail
cd "$(dirname "$0")"

for d in remote-auth remote-landing remote-landing-tenant; do
  echo "== $d: web =="
  (cd "$d" && bunx rsbuild build --environment web >/dev/null)
  echo "== $d: node (ssr) =="
  (cd "$d" && bunx rsbuild build --environment node >/dev/null && cp src/manifest.gen.json dist/ssr/)
done

if [[ "${1:-}" == "--with-guard" ]]; then
  echo "== remote-auth: guard variant (react requiredVersion 19.3.0) =="
  (cd remote-auth && MF_GUARD_BUILD=1 MF_REACT_REQUIRED_VERSION=19.3.0 bunx rsbuild build --environment node >/dev/null && cp src/manifest.gen.json dist-bad/ssr/)
fi

for d in remote-auth remote-landing remote-landing-tenant; do
  test -f "$d/dist/remoteEntry.js" && test -f "$d/dist/ssr/remoteEntry.server.js" && test -f "$d/dist/ssr/manifest.gen.json"
  echo "ok: $d (web + ssr + manifest)"
done
test -f remote-auth/dist-bad/ssr/remoteEntry.server.js 2>/dev/null && echo "ok: guard variant" || true
