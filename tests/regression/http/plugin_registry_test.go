package regression

import (
	"encoding/json"
	"testing"

	"everything.dev/regression/http/internal/regtest"
)

func TestPluginPassthrough(t *testing.T) {
	client := regtest.NewCookieClient()

	// Sign in anonymously for subsequent requests
	t.Run("sign_in", func(t *testing.T) {
		status, _, body := regtest.PostEmpty(t, client, baseURL+"/api/auth/sign-in/anonymous")
		regtest.MustStatus(t, status, 200, body)
	})

	var thingID string
	t.Run("create_thing", func(t *testing.T) {
		status, _, body := regtest.PostJSON(t, client, baseURL+"/api/things", map[string]any{
			"pluginId": "template",
			"payload": map[string]string{
				"kind":   "regression",
				"source": "plugin-passthrough",
			},
		}, nil)
		regtest.MustStatus(t, status, 200, body)

		var result struct {
			ThingID  string `json:"thingId"`
			PluginID string `json:"pluginId"`
			Type     string `json:"type"`
			Payload  struct {
				Kind   string `json:"kind"`
				Source string `json:"source"`
			} `json:"payload"`
		}
		if err := json.Unmarshal([]byte(body), &result); err != nil {
			t.Fatalf("decoding thing response: %v\nBody: %s", err, body)
		}

		if result.ThingID == "" {
			t.Fatal("expected non-empty thingId")
		}
		if result.PluginID != "template" {
			t.Fatalf("expected pluginId 'template', got %q", result.PluginID)
		}
		if result.Type != "template.regression" {
			t.Fatalf("expected type 'template.regression', got %q", result.Type)
		}
		if result.Payload.Kind != "regression" {
			t.Fatalf("expected payload.kind 'regression', got %q", result.Payload.Kind)
		}
		thingID = result.ThingID
	})

	t.Run("read_thing_back", func(t *testing.T) {
		status, _, body := regtest.GetRaw(t, client, baseURL+"/api/things/"+thingID)
		regtest.MustStatus(t, status, 200, body)

		var result struct {
			ThingID  string `json:"thingId"`
			PluginID string `json:"pluginId"`
			Type     string `json:"type"`
		}
		if err := json.Unmarshal([]byte(body), &result); err != nil {
			t.Fatalf("decoding thing response: %v\nBody: %s", err, body)
		}

		if result.ThingID != thingID {
			t.Fatalf("expected thingId %q, got %q", thingID, result.ThingID)
		}
		if result.PluginID != "template" {
			t.Fatalf("expected pluginId 'template', got %q", result.PluginID)
		}
	})

	t.Run("api_ping", func(t *testing.T) {
		status, _, body := regtest.GetRaw(t, client, baseURL+"/api/ping")
		regtest.MustStatus(t, status, 200, body)

		var result struct {
			Status    string `json:"status"`
			Timestamp string `json:"timestamp"`
		}
		if err := json.Unmarshal([]byte(body), &result); err != nil {
			t.Fatalf("decoding ping response: %v\nBody: %s", err, body)
		}

		if result.Status != "ok" {
			t.Fatalf("expected ping status 'ok', got %q", result.Status)
		}
		if result.Timestamp == "" {
			t.Fatal("expected non-empty timestamp")
		}
	})
}
