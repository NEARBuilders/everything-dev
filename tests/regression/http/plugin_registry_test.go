package regression

import (
	"encoding/json"
	"net/url"
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
		status, _, body := regtest.PostJSON(t, client, baseURL+"/api/rpc/template/createThing", map[string]any{
			"json": map[string]any{
				"thingId": "regression-plugin-test",
				"payload": map[string]string{
					"kind":   "regression",
					"source": "plugin-passthrough",
				},
			},
		}, nil)
		regtest.MustStatus(t, status, 200, body)

		var result struct {
			JSON struct {
				ThingID string `json:"thingId"`
				Type    string `json:"type"`
				Action  string `json:"action"`
			} `json:"json"`
		}
		if err := json.Unmarshal([]byte(body), &result); err != nil {
			t.Fatalf("decoding thing response: %v\nBody: %s", err, body)
		}

		if result.JSON.ThingID == "" {
			t.Fatal("expected non-empty thingId")
		}
		if result.JSON.Type == "" {
			t.Fatal("expected non-empty type")
		}
		if result.JSON.Action == "" {
			t.Fatal("expected non-empty action")
		}
		thingID = result.JSON.ThingID
	})

	t.Run("read_thing_back", func(t *testing.T) {
		data := url.QueryEscape(`{"json":{"thingId":"` + thingID + `"}}`)
		status, _, body := regtest.GetRaw(t, client, baseURL+"/api/rpc/template/getThing?data="+data)
		regtest.MustStatus(t, status, 200, body)

		var result struct {
			JSON struct {
				ThingID string `json:"thingId"`
				Type    string `json:"type"`
			} `json:"json"`
		}
		if err := json.Unmarshal([]byte(body), &result); err != nil {
			t.Fatalf("decoding thing response: %v\nBody: %s", err, body)
		}

		if result.JSON.ThingID != thingID {
			t.Fatalf("expected thingId %q, got %q", thingID, result.JSON.ThingID)
		}
		if result.JSON.Type == "" {
			t.Fatal("expected non-empty type")
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
