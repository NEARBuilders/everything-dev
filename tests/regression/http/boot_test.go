package regression

import (
	"testing"

	"everything.dev/regression/http/internal/regtest"
)

func TestBootSurface(t *testing.T) {
	client := regtest.NewCookieClient()

	t.Run("health", func(t *testing.T) {
		body, resp := regtest.GetText(t, client, baseURL+"/health")
		regtest.MustStatus(t, resp, 200)
		if body != "OK" {
			t.Fatalf("expected body OK, got %q", body)
		}
	})

	t.Run("api_health", func(t *testing.T) {
		var result struct {
			Status  string `json:"status"`
			Auth    struct {
				Mounted bool `json:"mounted"`
			} `json:"auth"`
			Plugins struct {
				Loaded int `json:"loaded"`
			} `json:"plugins"`
		}
		regtest.GetJSON(t, client, baseURL+"/api/_health", &result)

		if result.Status != "ready" {
			t.Fatalf("expected status 'ready', got %q", result.Status)
		}
		if !result.Auth.Mounted {
			t.Fatal("auth should be mounted")
		}
		if result.Plugins.Loaded < 1 {
			t.Fatalf("expected at least 1 plugin loaded, got %d", result.Plugins.Loaded)
		}
	})

	t.Run("root", func(t *testing.T) {
		body, resp := regtest.GetText(t, client, baseURL+"/")
		regtest.MustStatus(t, resp, 200)
		regtest.MustHeaderContains(t, resp, "Content-Type", "text/html")
		if !regtest.HTMLContainsRuntimeConfig(body) {
			t.Fatal("root HTML missing window.__RUNTIME_CONFIG__")
		}
		if !regtest.HTMLContainsTitle(body) {
			t.Fatal("root HTML missing title")
		}
	})

	t.Run("skill_md", func(t *testing.T) {
		_, resp := regtest.GetText(t, client, baseURL+"/skill.md")
		regtest.MustStatus(t, resp, 200)
		regtest.MustNotContain(t, resp.Header.Get("Content-Type"), "text/html")
	})

	t.Run("llms_txt", func(t *testing.T) {
		_, resp := regtest.GetText(t, client, baseURL+"/llms.txt")
		regtest.MustStatus(t, resp, 200)
		regtest.MustNotContain(t, resp.Header.Get("Content-Type"), "text/html")
	})

	t.Run("site_webmanifest", func(t *testing.T) {
		_, resp := regtest.GetText(t, client, baseURL+"/site.webmanifest")
		regtest.MustStatus(t, resp, 200)
		ct := resp.Header.Get("Content-Type")
		if ct != "application/manifest+json" && ct != "application/json" {
			t.Fatalf("expected manifest content type, got %q", ct)
		}
	})
}
