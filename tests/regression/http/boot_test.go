package regression

import (
	"encoding/json"
	"strings"
	"testing"

	"everything.dev/regression/http/internal/regtest"
)

func TestBootSurface(t *testing.T) {
	client := regtest.NewCookieClient()

	t.Run("health", func(t *testing.T) {
		status, _, body := regtest.GetRaw(t, client, baseURL+"/health")
		regtest.MustStatus(t, status, 200, body)
		if body != "OK" {
			t.Fatalf("expected body OK, got %q", body)
		}
	})

	t.Run("api_health", func(t *testing.T) {
		status, _, body := regtest.GetRaw(t, client, baseURL+"/api/_health")
		regtest.MustStatus(t, status, 200, body)

		var result struct {
			Status  string `json:"status"`
			Auth    struct {
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
