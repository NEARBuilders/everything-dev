package regression

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"everything.dev/regression/http/internal/regtest"
)

// TestPluginChurnAdopt is the backend dev-loop money test (issue #942): churn
// a plugin's source, dev-shape rebuild it while the dev stack keeps running,
// and verify the next request serves the NEW plugin generation with NO manual
// restart — the host's dev adopt reloads the in-process plugin and swaps the
// serving router; the supervisor's adopt replaces the plugin child.
//
// The coherence invariant rides every poll: each response must be a healthy
// 200 carrying the OLD generation's count (0 for a fresh entity) or the NEW
// generation's count (baseline + churn marker) — never an error, never a
// mixed value. The serving pair never splits mid-adopt.
func TestPluginChurnAdopt(t *testing.T) {
	if os.Getenv("BOS_FIXTURE_CHURN") != "1" {
		t.Skip("fixture-churn acceptance — run with BOS_FIXTURE_CHURN=1 (pnpm run test:regression:http:churn:dev)")
	}

	client := regtest.NewCookieClient()
	entityID := fmt.Sprintf("churn-%d", time.Now().UnixMilli())

	// Baseline: the plugin route must be healthy and serving the boot
	// generation (totalCount 0 for a fresh entity) before churning.
	if baseline := pluginVoteCount(t, client, entityID, "baseline", 0); baseline != 0 {
		t.Fatalf("[baseline] expected totalCount 0 for a fresh entity, got %d", baseline)
	}
	time.Sleep(3 * time.Second)

	offsets := regtest.LogOffsets(t, regtest.RegressionLogsWithMarks(t))
	marker := regtest.EditVotesSourceWithMarker(t)
	regtest.DevShapeRebuildPlugin(t, "plugins/votes")

	// Poll past the settle window + reload time: the next request must serve
	// the new generation without any manual restart, and every response in
	// the window must stay on one coherent generation.
	deadline := time.Now().Add(90 * time.Second)
	swapped := false
	for time.Now().Before(deadline) {
		if pluginVoteCount(t, client, entityID, "post-churn", marker) == marker {
			swapped = true
			break
		}
		time.Sleep(2 * time.Second)
	}
	if !swapped {
		t.Fatalf("churn marker %d never served — the plugin generation did not adopt without a restart", marker)
	}

	// The host serving plane's adopt is machine-readable: /health reports
	// the dev adopt's per-plugin serving generations (dev only) — the
	// ADR 0048 contract (HTTP over log text). The supervisor's child
	// replacement line (`[dev] plugins/votes moved to generation 1`) is the
	// second half of the UX contract and rides the session log.
	healthDeadline := time.Now().Add(10 * time.Second)
	adopted := false
	for time.Now().Before(healthDeadline) && !adopted {
		status, _, body := regtest.GetRaw(t, client, baseURL+"/health")
		if status != 200 {
			t.Fatalf("[health] expected 200 during the adopt check, got %d: %s", status, body)
		}
		var payload struct {
			DevAdopt struct {
				Generations map[string]int `json:"generations"`
			} `json:"devAdopt"`
		}
		if err := json.Unmarshal([]byte(body), &payload); err != nil {
			t.Fatalf("[health] undecodable body: %v\nBody: %s", err, body)
		}
		adopted = payload.DevAdopt.Generations["votes"] >= 1
		if !adopted {
			time.Sleep(500 * time.Millisecond)
		}
	}
	if !adopted {
		t.Fatalf("/health never reported a dev-adopt generation for votes — the serving plane did not commit the adopt")
	}

	// The supervisor's child-replacement line is the log contract; the move
	// line trails the marker by a log write, so poll the tail since the
	// pre-churn offset (LinesSince consumes incrementally) until it lands.
	supervisorNeedle := "[dev] plugins/votes moved to generation 1"
	logs := regtest.RegressionLogsWithMarks(t)
	scanDeadline := time.Now().Add(10 * time.Second)
	adoptedLine := false
	for time.Now().Before(scanDeadline) && !adoptedLine {
		tail, nextOffsets := regtest.LinesSince(logs, offsets)
		offsets = nextOffsets
		adoptedLine = strings.Contains(tail, supervisorNeedle)
		if !adoptedLine {
			time.Sleep(500 * time.Millisecond)
		}
	}
	if !adoptedLine {
		t.Fatalf("the dev session never logged %q — the child replacement did not hold\nlogs: %v", supervisorNeedle, logs)
	}
}

// pluginVoteCount posts the votes plugin's anonymous count route through the
// host's composed /api/rpc/votes prefix and fails the test on anything that
// is not a coherent 200: an error status, an error envelope, or a body that
// does not decode. The poll loop's "never splits" invariant lives here.
func pluginVoteCount(t *testing.T, client *http.Client, entityID string, phase string, marker int64) int64 {
	t.Helper()
	status, headers, body := regtest.PostJSON(t, client, baseURL+"/api/rpc/votes/getUpvoteCount", map[string]any{
		"json": map[string]any{"entityId": entityID},
	}, nil)
	if status != 200 {
		t.Fatalf("[%s] expected 200, got %d: %s\nBody: %s", phase, status, regtest.HeadersToString(headers), body)
	}
	var envelope struct {
		JSON struct {
			EntityID   string `json:"entityId"`
			TotalCount int64  `json:"totalCount"`
		} `json:"json"`
		Code string `json:"code"`
	}
	if err := json.Unmarshal([]byte(body), &envelope); err != nil {
		t.Fatalf("[%s] undecodable response: %v\nBody: %s", phase, err, body)
	}
	if envelope.Code != "" {
		t.Fatalf("[%s] oRPC error envelope: %s", phase, body)
	}
	if envelope.JSON.TotalCount != 0 && envelope.JSON.TotalCount != marker {
		t.Fatalf("[%s] incoherent generation — totalCount %d is neither the old generation (0) nor the new (%d)\nBody: %s",
			phase, envelope.JSON.TotalCount, marker, body)
	}
	return envelope.JSON.TotalCount
}
