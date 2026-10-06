package regression

import (
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"everything.dev/regression/http/internal/regtest"
)

func TestSecurityHeaders(t *testing.T) {
	client := regtest.NewCookieClient()

	for _, path := range []string{"/", "/api"} {
		path := path
		name := "csp_" + strings.Trim(path, "/")
		t.Run(name, func(t *testing.T) {
			status, headers, body := regtest.GetRaw(t, client, baseURL+path)
			if status != 200 && status != 401 {
				t.Fatalf("expected 200 or 401, got %d: %s", status, body)
			}

			csp := headers.Get("Content-Security-Policy")
			if csp == "" {
				t.Fatalf("expected Content-Security-Policy header on %s", path)
			}
			for _, directive := range []string{
				"default-src 'self'",
				"object-src 'none'",
				"base-uri 'self'",
				"form-action 'self'",
				"frame-ancestors 'none'",
			} {
				if !strings.Contains(csp, directive) {
					t.Fatalf("CSP on %s must contain %s\ngot: %s", path, directive, csp)
				}
			}
		})
	}

	t.Run("root_security_headers", func(t *testing.T) {
		_, headers, _ := regtest.GetRaw(t, client, baseURL+"/")
		expected := map[string]string{
			"Referrer-Policy":            "no-referrer",
			"X-Content-Type-Options":     "nosniff",
			"Cross-Origin-Opener-Policy": "same-origin",
			"X-Frame-Options":            "",
		}
		for hdr, substr := range expected {
			val := headers.Get(hdr)
			if val == "" {
				t.Fatalf("expected %s header to be present", hdr)
			}
			if substr != "" && !strings.Contains(val, substr) {
				t.Fatalf("expected %s to contain %q, got %q", hdr, substr, val)
			}
		}
	})
}

func TestCSRFProtection(t *testing.T) {
	client := regtest.NewCookieClient()

	t.Run("evil_origin_rejected", func(t *testing.T) {
		status, _, body := regtest.PostJSON(t, client, baseURL+"/api/ping", map[string]any{}, map[string]string{
			"Origin": "https://evil.example.com",
		})
		regtest.MustStatus(t, status, 403, body)
		regtest.MustContain(t, body, "CSRF")
	})

	t.Run("no_origin_not_blocked_by_csrf", func(t *testing.T) {
		status, _, _ := regtest.PostJSON(t, client, baseURL+"/api/ping", map[string]any{}, nil)
		if status == 403 {
			t.Fatal("request without an Origin header must not be rejected by CSRF")
		}
	})

	t.Run("matching_origin_not_blocked_by_csrf", func(t *testing.T) {
		status, _, _ := regtest.PostJSON(t, client, baseURL+"/api/ping", map[string]any{}, map[string]string{
			"Origin": baseURL,
		})
		if status == 403 {
			t.Fatal("request with matching Origin must not be rejected by CSRF")
		}
	})
}

func TestBodyLimit(t *testing.T) {
	client := regtest.NewCookieClient()

	t.Run("oversized_body_rejected", func(t *testing.T) {
		big := strings.Repeat("a", 70*1024)
		status, _, body := regtest.PostRaw(t, client, baseURL+"/api/ping", []byte(big), map[string]string{
			"Content-Type": "application/text",
		})
		regtest.MustStatus(t, status, 413, body)
		regtest.MustContain(t, body, "Request body too large")
	})

	t.Run("small_body_not_rejected", func(t *testing.T) {
		status, _, _ := regtest.PostRaw(t, client, baseURL+"/api/ping", []byte(`{"hello":"world"}`), map[string]string{
			"Content-Type": "application/json",
		})
		if status == 413 {
			t.Fatal("small body must not be rejected by the body limit")
		}
	})
}

func TestRateLimiting(t *testing.T) {
	client := regtest.NewCookieClient()

	// Clear any residual count in the current window so the burst is deterministic.
	time.Sleep(1200 * time.Millisecond)

	// Fire 150 requests concurrently so they all land inside a single 1000ms
	// window. The regression env pins RATE_LIMIT_WINDOW_MS=1000 and
	// RATE_LIMIT_MAX=100.
	const workers = 10
	const perWorker = 15

	// burst fires `path` concurrently with plain (no cookie jar) clients and
	// records which statuses were observed.
	burst := func(path string) (got200, got429 bool, lastRateLimitBody string) {
		var (
			mu sync.Mutex
			wg sync.WaitGroup
		)
		for w := 0; w < workers; w++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				plain := &http.Client{}
				for i := 0; i < perWorker; i++ {
					resp, err := plain.Get(baseURL + path)
					if err != nil {
						continue
					}
					b, _ := io.ReadAll(resp.Body)
					resp.Body.Close()
					mu.Lock()
					if resp.StatusCode == 200 {
						got200 = true
					}
					if resp.StatusCode == 429 {
						got429 = true
						lastRateLimitBody = string(b)
					}
					mu.Unlock()
				}
			}()
		}
		wg.Wait()
		return got200, got429, lastRateLimitBody
	}

	// Health probes are exempt from the limiter — the burst must never trip
	// it, no matter how large (Kubernetes probes share the client budget).
	probe200, probe429, _ := burst("/health")
	if !probe200 {
		t.Fatal("expected health probes to answer 200")
	}
	if probe429 {
		t.Fatal("health probes must be exempt from the rate limit")
	}

	// A regular API endpoint is limited: 150 > 100 guarantees at least one 429.
	got200, got429, lastRateLimitBody := burst("/api/ping")
	if !got200 {
		t.Fatal("expected at least one 200 in the burst before the rate limit applies")
	}
	if !got429 {
		t.Fatal("expected at least one 429 after exceeding the rate limit")
	}
	if !strings.Contains(lastRateLimitBody, "Too many requests") {
		t.Fatalf("expected rate-limit JSON body, got: %q", lastRateLimitBody)
	}

	// After the sliding window passes the server must recover.
	time.Sleep(1200 * time.Millisecond)
	status, _, body := regtest.GetRaw(t, client, baseURL+"/api/ping")
	regtest.MustStatus(t, status, 200, body)
}
