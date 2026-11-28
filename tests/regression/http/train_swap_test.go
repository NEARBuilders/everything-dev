package regression

import (
	"os"
	"strings"
	"testing"
	"time"

	"everything.dev/regression/http/internal/regtest"
)

// TestTrainBuildUnderSsrTraffic is the #940 arbiter: run the PLAIN build
// train (`pnpm run build ui` — no SSR stamps) WHILE a dev:ssr stack serves,
// and hold the line on two invariants — every SSR response stays healthy
// during the whole train (the train must not wipe the running container, the
// host must not 500 a healthy tree), and the tree recovers to the new
// generation once a dev-shape rebuild lands (the #938 swap machinery).
func TestTrainBuildUnderSsrTraffic(t *testing.T) {
	if os.Getenv("BOS_FIXTURE_CHURN") != "1" {
		t.Skip("fixture-churn acceptance — run with BOS_FIXTURE_CHURN=1 (pnpm run test:regression:http:churn:dev)")
	}
	if !ssrMode() {
		t.Skip("the train churn targets the SSR pipeline; this mode boots without --ssr")
	}

	client := regtest.NewCookieClient()

	assertSSRHealthy(t, client, "baseline")
	time.Sleep(time.Second)

	marker := regtest.EditUiSourceWithMarker(t)

	trainErr := make(chan error, 1)
	go func() { trainErr <- regtest.PlainTrainBuildUi() }()

	trainDone := false
	for !trainDone {
		select {
		case err := <-trainErr:
			if err != nil {
				t.Fatal(err)
			}
			trainDone = true
		default:
			body := assertSSRHealthy(t, client, "during-train")
			if strings.Contains(body, marker) {
				t.Fatalf("the plain train's bytes leaked into the served tree — the SSR container must stay the pre-train generation")
			}
			time.Sleep(1500 * time.Millisecond)
		}
	}

	container := regtest.UiSsrContainerPath(t)
	if _, err := os.Stat(container); err != nil {
		t.Fatalf("the plain train wiped the running dev SSR container (%s): %v", container, err)
	}

	// The plain train produces no new SSR generation (web-only build) — the
	// served tree must still be the pre-train one, healthy throughout. The
	// dev-shape rebuild below is what advances the container; the new
	// generation's marker must render on the next compose.
	regtest.DevShapeRebuildUi(t)

	deadline := time.Now().Add(75 * time.Second)
	swapped := false
	for time.Now().Before(deadline) {
		body := assertSSRHealthy(t, client, "post-train-rebuild")
		if strings.Contains(body, marker) {
			swapped = true
			break
		}
		time.Sleep(3 * time.Second)
	}
	if !swapped {
		t.Fatalf("churn marker %q never rendered after the dev-shape rebuild — the tree did not recover to the new generation", marker)
	}
}
