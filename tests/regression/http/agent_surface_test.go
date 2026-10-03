package regression

import (
	"encoding/json"
	"strings"
	"testing"

	"everything.dev/regression/http/internal/regtest"
)

func TestAgentSurface(t *testing.T) {
	client := regtest.NewCookieClient()

	t.Run("llms_txt_mentions_mcp", func(t *testing.T) {
		status, _, body := regtest.GetRaw(t, client, baseURL+"/llms.txt")
		regtest.MustStatus(t, status, 200, body)
		regtest.MustContain(t, body, "/api/mcp")
		regtest.MustContain(t, body, "/skill.md")
	})

	t.Run("skill_md_mentions_mcp_and_api_keys", func(t *testing.T) {
		status, _, body := regtest.GetRaw(t, client, baseURL+"/skill.md")
		regtest.MustStatus(t, status, 200, body)
		regtest.MustContain(t, body, "/api/mcp")
		regtest.MustContain(t, body, "x-api-key")
		regtest.MustContain(t, body, "/settings/api-keys")

		ct := ""
		for _, line := range strings.Split(body, "\n") {
			_ = line
		}
		_ = ct
	})

	t.Run("well_known_mcp_json", func(t *testing.T) {
		status, headers, body := regtest.GetRaw(t, client, baseURL+"/.well-known/mcp.json")
		regtest.MustStatus(t, status, 200, body)

		ct := headers.Get("Content-Type")
		if !strings.Contains(ct, "application/json") {
			t.Fatalf("expected application/json content-type, got %q", ct)
		}

		var result struct {
			Name      string `json:"name"`
			Endpoint  string `json:"endpoint"`
			Transport string `json:"transport"`
			Auth      struct {
				Type   string `json:"type"`
				Header string `json:"header"`
			} `json:"auth"`
		}
		if err := json.Unmarshal([]byte(body), &result); err != nil {
			t.Fatalf("decoding mcp.json: %v\nBody: %s", err, body)
		}

		if result.Name == "" {
			t.Fatal("expected non-empty name")
		}
		if !strings.Contains(result.Endpoint, "/api/mcp") {
			t.Fatalf("expected endpoint to contain '/api/mcp', got %q", result.Endpoint)
		}
		if result.Transport != "streamable-http" {
			t.Fatalf("expected transport 'streamable-http', got %q", result.Transport)
		}
		if result.Auth.Type != "api-key" {
			t.Fatalf("expected auth.type 'api-key', got %q", result.Auth.Type)
		}
		if result.Auth.Header != "x-api-key" {
			t.Fatalf("expected auth.header 'x-api-key', got %q", result.Auth.Header)
		}
	})
}
