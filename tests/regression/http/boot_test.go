package regression

import (
	"encoding/json"
	"strings"
	"testing"

	"everything.dev/regression/http/internal/regtest"
)

func TestBootSurface(t *testing.T) {
	client := regtest.NewCookieClient()

	// tail returns the end of a response body for failure messages.
	tail := func(body string, n int) string {
		if len(body) <= n {
			return body
		}
		return "…" + body[len(body)-n:]
	}

	t.Run("health", func(t *testing.T) {
		status, _, body := regtest.GetRaw(t, client, baseURL+"/health")
		regtest.MustStatus(t, status, 200, body)
		if !regtest.StatusReady(body) {
			t.Fatalf("expected health to report ready, got %q", body)
		}
	})

	t.Run("api_health", func(t *testing.T) {
		status, _, body := regtest.GetRaw(t, client, baseURL+"/api/_health")
		regtest.MustStatus(t, status, 200, body)

		var result struct {
			Status string `json:"status"`
			Auth   struct {
				Mounted bool `json:"mounted"`
			} `json:"auth"`
			Plugins struct {
				Loaded []string `json:"loaded"`
			} `json:"plugins"`
		}
		if err := json.Unmarshal([]byte(body), &result); err != nil {
			t.Fatalf("decoding api health: %v\nBody: %s", err, body)
		}

		if result.Status != "ready" {
			t.Fatalf("expected status 'ready', got %q", result.Status)
		}
		if !result.Auth.Mounted {
			t.Fatal("auth should be mounted")
		}
		if len(result.Plugins.Loaded) < 1 {
			t.Fatalf("expected at least 1 plugin loaded, got %d", len(result.Plugins.Loaded))
		}
	})

	t.Run("root", func(t *testing.T) {
		status, headers, body := regtest.GetRaw(t, client, baseURL+"/")
		regtest.MustStatus(t, status, 200, body)
		regtest.MustHeaderContains(t, headers, "Content-Type", "text/html")
		regtest.MustContain(t, body, "window.__RUNTIME_CONFIG__")
		regtest.MustContain(t, body, "<title>")

		// SSR content gate: the start:ssr stack serves production SSR. When
		// the server render fails, the host falls back to the client shell —
		// status 200, valid HTML, both assertions above still pass — so the
		// regression must assert on rendered content, not just shape. A shell
		// body never contains the composed route tree's markup.
		if strings.Contains(body, "SSR unavailable") {
			t.Fatalf("SSR fell back to the client shell (server render failed):\n%s", tail(body, 600))
		}
		if strings.Contains(body, `<div class="shell">`) {
			t.Fatalf("served the client-shell fallback instead of SSR'd content:\n%s", tail(body, 600))
		}
		regtest.MustContain(t, body, `data-testid="landing-steps"`)
		if ssrMode() {
			regtest.MustContain(t, body, "data-everything-ssr")
			regtest.MustContain(t, headers.Get("Server-Timing"), "total;dur=")
		}
	})

	t.Run("skill_md", func(t *testing.T) {
		status, headers, body := regtest.GetRaw(t, client, baseURL+"/skill.md")
		regtest.MustStatus(t, status, 200, body)
		ct := headers.Get("Content-Type")
		if strings.Contains(ct, "text/html") {
			t.Fatalf("expected non-HTML content-type for skill.md, got %q", ct)
		}
	})

	t.Run("llms_txt", func(t *testing.T) {
		status, headers, body := regtest.GetRaw(t, client, baseURL+"/llms.txt")
		regtest.MustStatus(t, status, 200, body)
		ct := headers.Get("Content-Type")
		if strings.Contains(ct, "text/html") {
			t.Fatalf("expected non-HTML content-type for llms.txt, got %q", ct)
		}
	})

	t.Run("site_webmanifest", func(t *testing.T) {
		status, headers, body := regtest.GetRaw(t, client, baseURL+"/site.webmanifest")
		regtest.MustStatus(t, status, 200, body)
		ct := headers.Get("Content-Type")
		if !strings.Contains(ct, "application/manifest+json") && !strings.Contains(ct, "application/json") {
			t.Fatalf("expected manifest or json content type, got %q", ct)
		}
	})
}
