package regression

import (
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"everything.dev/regression/http/internal/regtest"
)

// TestUiChurnSwap is the module-swap money test (epic #473, tickets #469/#471):
// churn the ui source, dev-shape rebuild it while the dev:ssr stack keeps
// running, and verify the hot swap end to end — the next compose re-loads the
// fresh container AND the new generation's bytes actually render (the churn
// marker appears in the SSR HTML), with the tree staying consistent
// throughout: no error shells, no mixed-version failure classes.
func TestUiChurnSwap(t *testing.T) {
	if os.Getenv("BOS_FIXTURE_CHURN") != "1" {
		t.Skip("fixture-churn acceptance — run with BOS_FIXTURE_CHURN=1 (pnpm run test:regression:http:churn:dev)")
	}
	if !ssrMode() {
		t.Skip("churn swap targets the SSR pipeline; this mode boots without --ssr")
	}

	client := regtest.NewCookieClient()

	// Baseline: the SSR surface must be healthy before churning.
	assertSSRHealthy(t, client, "baseline")
	time.Sleep(time.Second)
	// KEEP: container-version log marks are #477 loader instrumentation
	// (entry URLs with ?v=) — main has no such marks, so the marker-in-HTML
	// assertion below is the sole hot-swap evidence; that is the experiment.
	marker := regtest.EditUiSourceWithMarker(t)
	regtest.DevShapeRebuildUi(t)

	// Poll past the manifest TTL (30s) + margin: the next compose must pick
	// up the new container version, re-render the tree from the fresh
	// container's bytes, and keep serving a consistent tree throughout.
	deadline := time.Now().Add(75 * time.Second)
	swapped := false
	for time.Now().Before(deadline) {
		body := assertSSRHealthy(t, client, "post-churn")
		if strings.Contains(body, marker) {
			swapped = true
			break
		}
		time.Sleep(3 * time.Second)
	}
	if !swapped {
		t.Fatalf("churn marker %q never rendered — the hot swap did not propagate to the served tree", marker)
	}
}

// assertSSRHealthy pins the consistency invariants on one /about response:
// 200, real SSR (data-everything-ssr), Server-Timing, and none of the failure
// shells or mixed-version error classes. Returns the body for content checks.
func assertSSRHealthy(t *testing.T, client *http.Client, phase string) string {
	t.Helper()
	status, headers, body := regtest.GetRaw(t, client, baseURL+"/about")
	if status != 200 {
		t.Fatalf("[%s] expected 200, got %d: %s", phase, status, regtest.HeadersToString(headers))
	}
	regtest.MustContain(t, body, "data-everything-ssr")
	regtest.MustContain(t, headers.Get("Server-Timing"), "total;dur=")
	for _, forbidden := range []string{
		"SSR unavailable",
		"SSR composition failed",
		"Invalid hook call",
		"Minified React error",
		"HYDRATION",
	} {
		if strings.Contains(body, forbidden) {
			snippet := body
			if len(snippet) > 2000 {
				snippet = snippet[len(snippet)-2000:]
			}
			t.Fatalf("[%s] SSR tree not consistent: response contains %q\nBody: %s", phase, forbidden, snippet)
		}
	}
	return body
}
