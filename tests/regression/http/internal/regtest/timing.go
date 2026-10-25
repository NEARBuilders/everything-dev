package regtest

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type ServerTiming map[string]float64

// ParseServerTiming reads an SSR `server-timing` header of the shape
// `compose;dur=1.2, render;dur=3.4, total;dur=4.5`.
func ParseServerTiming(header string) ServerTiming {
	out := ServerTiming{}
	for _, part := range strings.Split(header, ",") {
		kv := strings.SplitN(part, ";", 2)
		if len(kv) != 2 {
			continue
		}
		name := strings.TrimSpace(kv[0])
		dur, err := strconv.ParseFloat(strings.TrimSpace(strings.TrimPrefix(kv[1], "dur=")), 64)
		if err != nil {
			continue
		}
		out[name] = dur
	}
	return out
}

// SSRProbe is one harness-level sample of an SSR'd root page: TTFB plus the
// parsed server-timing durations the host instruments.
type SSRProbe struct {
	Status   int          `json:"-"`
	HTTPCode string       `json:"-"`
	TTFBMs   float64      `json:"ttfbMs"`
	TotalMs  float64      `json:"totalMs"`
	Compose  float64      `json:"composeMs"`
	Render   float64      `json:"renderMs"`
	SSRHtml  bool         `json:"ssrHtml"`
	Timing   ServerTiming `json:"serverTiming"`
}

// ProbeSSR performs one GET of the root HTML and turns the response into an
// SSRProbe. Transport failures return an error; a non-200 status is not an
// error — the caller decides what qualifies as a sample.
func ProbeSSR(client *http.Client, baseURL string) (*SSRProbe, error) {
	start := time.Now()
	resp, err := client.Get(baseURL + "/")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	ttfbMs := float64(time.Since(start).Microseconds()) / 1000
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	totalMs := float64(time.Since(start).Microseconds()) / 1000

	probe := &SSRProbe{
		Status:   resp.StatusCode,
		HTTPCode: strconv.Itoa(resp.StatusCode),
		TTFBMs:   round1(ttfbMs),
		TotalMs:  round1(totalMs),
		SSRHtml:  strings.Contains(string(body), "data-everything-ssr"),
		Timing:   ServerTiming{},
	}
	if header := resp.Header.Get("server-timing"); header != "" {
		probe.Timing = ParseServerTiming(header)
		probe.Compose = probe.Timing["compose"]
		probe.Render = probe.Timing["render"]
	}
	return probe, nil
}

func round1(v float64) float64 {
	return float64(int(v*10+0.5)) / 10
}

// ReadyMeasurement is the readiness timing out of WaitForReady.
type ReadyMeasurement struct {
	Mode       string `json:"mode"`
	ElapsedMs  int64  `json:"readyElapsedMs"`
	BootRunner string `json:"-"`
}

var readyMu sync.Mutex
var lastReady *ReadyMeasurement

// RecordReady stores the latest readiness timing; TestMain's WaitForReady
// populates it, the bench test picks it up.
func RecordReady(m *ReadyMeasurement) {
	readyMu.Lock()
	defer readyMu.Unlock()
	lastReady = m
}

// TakeReady returns the latest readiness timing snapshot.
func TakeReady() *ReadyMeasurement {
	readyMu.Lock()
	defer readyMu.Unlock()
	return lastReady
}

// BootMetrics mirrors packages/everything-dev/src/boot-metrics.ts —
// the machine-readable boot record the session writes at session-ready.
type BootMetrics struct {
	Mode           string `json:"mode"`
	StartedAt      string `json:"startedAt"`
	SSR            bool   `json:"ssr"`
	TotalToReadyMs int64  `json:"totalToReadyMs"`
	Phases         []struct {
		Name       string  `json:"name"`
		DurationMs float64 `json:"durationMs"`
	} `json:"phases"`
	Services []struct {
		Name       string   `json:"name"`
		Source     string   `json:"source,omitempty"`
		StartingMs float64  `json:"startingMs"`
		ReadyMs    *float64 `json:"readyMs"`
		Status     string   `json:"status"`
		Message    string   `json:"message,omitempty"`
	} `json:"services"`
}

// ReadBootMetrics loads .bos/boot-metrics.json from the repo root. Returns
// nil without failing when the file is absent (test suites that hand-roll
// the stack live may never write it).
func ReadBootMetrics() *BootMetrics {
	data, err := os.ReadFile(filepath.Join(RepoRoot(), ".bos", "boot-metrics.json"))
	if err != nil {
		return nil
	}
	var metrics BootMetrics
	if err := json.Unmarshal(data, &metrics); err != nil {
		log.Printf("WARN: boot metrics unreadable: %v", err)
		return nil
	}
	return &metrics
}

// Percentile interpolates the p-th value of the samples.
func Percentile(samples []float64, p float64) float64 {
	if len(samples) == 0 {
		return 0
	}
	sorted := append([]float64(nil), samples...)
	sort.Float64s(sorted)
	if len(sorted) == 1 {
		return sorted[0]
	}
	rank := (p / 100) * float64(len(sorted)-1)
	lo := int(rank)
	hi := lo + 1
	if hi >= len(sorted) {
		return sorted[len(sorted)-1]
	}
	weight := rank - float64(lo)
	return sorted[lo] + weight*(sorted[hi]-sorted[lo])
}
