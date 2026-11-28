package regression

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"everything.dev/regression/http/internal/regtest"
)

// TestSSRBench records the SSR pipeline's harness-level timings (readiness,
// per-sample TTFB, server-timing components) for the mode the suite booted
// with. Gated behind BOS_SSR_BENCH=1 — the plain regression suites stay
// timing-free. Both modes are covered by running the suite scripts in turn:
//
//	BOS_SSR_BENCH=1 pnpm test:regression:http:dev
//	BOS_SSR_BENCH=1 pnpm test:regression:http:start
//
// Results land in .scratch/ssr-first-paint/baseline-<mode>.json.
func TestSSRBench(t *testing.T) {
	if os.Getenv("BOS_SSR_BENCH") != "1" {
		t.Skip("BOS_SSR_BENCH=1 enables the perf bench")
	}

	warmup := envInt("BOS_SSR_BENCH_WARMUP", 3)
	samples := envInt("BOS_SSR_BENCH_SAMPLES", 25)

	client := regtest.NewCookieClient()

	var ttfbs, composes, renders, totals, reads []float64
	var readyMs int64
	boot := regtest.ReadBootMetrics()

	for i := 0; i < warmup+samples; i++ {
		start := time.Now()
		probe, err := regtest.ProbeSSR(client, baseURL)
		if err != nil {
			t.Fatalf("SSR probe: %v", err)
		}
		if probe.Status != 200 {
			t.Fatalf("SSR probe returned %d", probe.Status)
		}
		if i < warmup {
			continue
		}
		ttfbs = append(ttfbs, probe.TTFBMs)
		composes = append(composes, probe.Compose)
		renders = append(renders, probe.Render)
		totals = append(totals, probe.TotalMs)
		reads = append(reads, float64(time.Since(start).Microseconds())/1000)
	}

	ready := regtest.TakeReady()
	if ready != nil {
		readyMs = ready.ElapsedMs
	}

	mode := modeForBaseline()
	t.Logf("%s bench — TTFB p50 %.1fms p95 %.1fms | compose p50 %.1fms p95 %.1fms | render p50 %.1fms p95 %.1fms | ready %dms",
		mode,
		regtest.Percentile(ttfbs, 50), regtest.Percentile(ttfbs, 95),
		regtest.Percentile(composes, 50), regtest.Percentile(composes, 95),
		regtest.Percentile(renders, 50), regtest.Percentile(renders, 95),
		readyMs,
	)

	record := map[string]any{
		"mode":       mode,
		"regression": modeLabelForFs(),
		"recordedAt": time.Now().UTC().Format(time.RFC3339),
		"ready": map[string]any{
			"elapsedMs": readyMs,
		},
		"bootMetrics": boot,
		"samples": map[string]any{
			"count":     len(ttfbs),
			"ttfbMs":    stats(ttfbs),
			"composeMs": stats(composes),
			"renderMs":  stats(renders),
			"totalMs":   stats(totals),
		},
	}
	writeBaseline(t, "baseline-"+modeLabelForFs()+".json", record)
}

func stats(samples []float64) map[string]float64 {
	p50 := regtest.Percentile(samples, 50)
	p95 := regtest.Percentile(samples, 95)
	mean := 0.0
	for _, s := range samples {
		mean += s
	}
	if len(samples) > 0 {
		mean /= float64(len(samples))
	}
	return map[string]float64{
		"p50":  round(p50),
		"p95":  round(p95),
		"mean": round(mean),
	}
}

func round(v float64) float64 {
	return float64(int(v*100+0.5)) / 100
}

func envInt(name string, fallback int) int {
	value, ok := os.LookupEnv(name)
	if !ok {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

// ssrMode reports whether the raw regression mode runs the SSR pipeline:
// dev:ssr and start:ssr pass --ssr; backcompat and default unset modes boot
// the no-SSR stack (start-stack.mjs / start-container.mjs).
func ssrMode() bool {
	raw := os.Getenv("REGRESSION_MODE")
	switch raw {
	case "dev", "dev:ssr", "start:ssr":
		return true
	}
	return false
}

// modeForBaseline carries the raw REGRESSION_MODE (dev:ssr / start:ssr /
// backcompat), not the collapsed Mode() target class.
func modeForBaseline() string {
	if mode := os.Getenv("REGRESSION_MODE"); mode != "" {
		return mode
	}
	return string(regtest.Mode())
}

// modeLabelForFs is filesystem-safe: ':' is not a valid component on every
// writer, so the baseline files use dashes.
func modeLabelForFs() string {
	return strings.ReplaceAll(modeForBaseline(), ":", "-")
}

func writeBaseline(t *testing.T, name string, record map[string]any) {
	t.Helper()
	workdir := regtest.RepoRoot()
	dir := filepath.Join(workdir, ".scratch", "ssr-first-paint")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("creating baseline dir: %v", err)
	}
	path := filepath.Join(dir, name)
	data, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		t.Fatalf("encoding baseline: %v", err)
	}
	if err := os.WriteFile(path, append(data, '\n'), 0o644); err != nil {
		t.Fatalf("writing baseline %s: %v", name, err)
	}
	t.Logf("baseline written: %s", fmt.Sprintf(".scratch/ssr-first-paint/%s", name))
}
