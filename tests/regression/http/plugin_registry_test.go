package regression

import (
	"testing"

	"everything.dev/regression/http/internal/regtest"
)

type registryStatusResp struct {
	DiscoveredApps      int    `json:"discoveredApps"`
	MetadataContractID  string `json:"metadataContractId"`
	MetadataFastKvURL   string `json:"metadataFastKvUrl"`
	RelayEnabled        bool   `json:"relayEnabled"`
	Timestamp           string `json:"timestamp"`
}

func TestPluginRouteMountedThroughHost(t *testing.T) {
	client := regtest.NewCookieClient()

	// Test read-only plugin route via OpenAPI handler
	t.Run("registry_status", func(t *testing.T) {
		var status registryStatusResp
		resp := regtest.GetJSON(t, client, baseURL+"/api/v1/registry/status", &status)

		regtest.MustStatus(t, resp, 200)

		if status.DiscoveredApps < 0 {
			t.Fatalf("discoveredApps should be >= 0, got %d", status.DiscoveredApps)
		}
		if status.MetadataContractID == "" {
			t.Fatal("metadataContractId should be non-empty")
		}
		if len(status.MetadataFastKvURL) < 8 || (status.MetadataFastKvURL[:8] != "https://") {
			t.Fatalf("expected metadataFastKvUrl to start with https://, got %q", status.MetadataFastKvURL)
		}
		if status.Timestamp == "" {
			t.Fatal("timestamp should be non-empty")
		}
	})

	// Test core API route via OpenAPI
	t.Run("api_ping", func(t *testing.T) {
		var result struct {
			Status    string `json:"status"`
			Timestamp string `json:"timestamp"`
		}
		resp := regtest.GetJSON(t, client, baseURL+"/api/ping", &result)
		regtest.MustStatus(t, resp, 200)
		if result.Status != "ok" {
			t.Fatalf("expected ping status 'ok', got %q", result.Status)
		}
		if result.Timestamp == "" {
			t.Fatal("expected non-empty timestamp in ping response")
		}
	})
}
