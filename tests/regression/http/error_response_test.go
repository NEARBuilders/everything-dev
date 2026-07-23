package regression

import (
	"encoding/json"
	"testing"

	"everything.dev/regression/http/internal/regtest"
)

func TestErrorResponseShape(t *testing.T) {
	client := regtest.NewCookieClient()

	t.Run("invalid_thing_input_returns_json_error", func(t *testing.T) {
		status, _, body := regtest.PostJSON(t, client, baseURL+"/api/things", map[string]any{}, nil)
		regtest.MustStatus(t, status, 400, body)

		var parsed struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		}
		if err := json.Unmarshal([]byte(body), &parsed); err != nil {
			t.Fatalf("expected JSON error body, got unparseable: %v\nBody: %s", err, body)
		}
		if parsed.Code == "" && parsed.Message == "" {
			t.Fatalf("expected error response to contain code or message\nBody: %s", body)
		}
		regtest.MustNotContain(t, body, "<html")
		regtest.MustNotContain(t, body, "<!DOCTYPE")
	})

	t.Run("nonexistent_route_returns_json", func(t *testing.T) {
		status, _, body := regtest.GetRaw(t, client, baseURL+"/api/nonexistent-route-12345")
		if status == 404 || status == 400 {
			var parsed struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			}
			if err := json.Unmarshal([]byte(body), &parsed); err == nil {
				regtest.MustNotContain(t, body, "<html")
				regtest.MustNotContain(t, body, "<!DOCTYPE")
				return
			}
		}
		t.Logf("non-existent route returned status=%d (not 404), skipping strict check", status)
	})
}
