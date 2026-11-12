/**
 * Upstream snapshot pin for the route-guard fixtures.
 *
 * The vendored files under fixtures/upstream/routes/ come from
 * NEARBuilders/everything-dev at this ref — chosen because it is the
 * gitHead commit of the exact package version this repo installs
 * (everything-dev@2.0.0-rc.10, per `npm view ... dist-tarball.gitHead`),
 * so the guard patterns in the snapshots compile against the installed
 * dist surface (everything-dev/ui/auth exports: requireSession,
 * requireAdmin, resolveSessionFromCache, clearAuthenticatedQueries).
 *
 * Refresh: fetch the four route files from a newer gitHead after an
 * upgrade, bump this constant, update tests that reference the ref.
 */
export const UPSTREAM_REF = "2fb30b297e30c06a24481b14fe32f1d06728644e";
