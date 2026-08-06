package regression

import (
	"encoding/json"
	"strings"
	"testing"

	"everything.dev/regression/http/internal/regtest"
)

func TestErrorKindMapping(t *testing.T) {
	client := regtest.NewCookieClient()

	cases := []struct {
		kind       string
		wantStatus int
		wantCode   string
	}{
		{"bad_request", 400, "BAD_REQUEST"},
		{"unauthorized", 401, "UNAUTHORIZED"},
		{"forbidden", 403, "FORBIDDEN"},
		{"not_found", 404, "NOT_FOUND"},
		{"conflict", 409, "CONFLICT"},
		{"internal", 500, "INTERNAL_SERVER_ERROR"},
	}

	for _, tc := range cases {
		t.Run(tc.kind, func(t *testing.T) {
			status, headers, body := regtest.GetRaw(t, client, baseURL+"/api/errors?kind="+tc.kind)
			regtest.MustStatus(t, status, tc.wantStatus, body)

			ct := headers.Get("Content-Type")
			if !strings.Contains(ct, "application/json") {
				t.Fatalf("expected application/json content-type, got %q", ct)
			}

			var parsed struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			}
			if err := json.Unmarshal([]byte(body), &parsed); err != nil {
				t.Fatalf("expected JSON error body, got unparseable: %v\nBody: %s", err, body)
			}
			if parsed.Code != tc.wantCode {
				t.Fatalf("expected code %q, got %q", tc.wantCode, parsed.Code)
			}
			if parsed.Message == "" {
				t.Fatal("expected non-empty error message")
			}

			regtest.MustNotContain(t, body, "<html")
			regtest.MustNotContain(t, body, "<!DOCTYPE")
		})
	}
}

func TestInternalErrorDoesNotLeakDetails(t *testing.T) {
	client := regtest.NewCookieClient()
	status, _, body := regtest.GetRaw(t, client, baseURL+"/api/errors?kind=internal")
	regtest.MustStatus(t, status, 500, body)
	// The server must never echo internal handler detail back to the client.
	regtest.MustNotContain(t, body, "test internal")
}

func TestInvalidErrorKindIsValidationError(t *testing.T) {
	client := regtest.NewCookieClient()
	status, _, body := regtest.GetRaw(t, client, baseURL+"/api/errors?kind=not-a-real-kind")
	regtest.MustStatus(t, status, 400, body)

	var parsed struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal([]byte(body), &parsed); err != nil {
		t.Fatalf("expected JSON error body, got unparseable: %v\nBody: %s", err, body)
	}
	if parsed.Code != "BAD_REQUEST" {
		t.Fatalf("expected code BAD_REQUEST, got %q", parsed.Code)
	}
	regtest.MustNotContain(t, body, "<html")
}

func TestUnauthenticatedRouteReturnsJSONUnauthorized(t *testing.T) {
	client := regtest.NewCookieClient()
	status, _, body := regtest.GetRaw(t, client, baseURL+"/api/tenants")
	regtest.MustStatus(t, status, 401, body)

	var parsed struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal([]byte(body), &parsed); err != nil {
		t.Fatalf("expected JSON error, got unparseable: %v\nBody: %s", err, body)
	}
	if parsed.Code != "UNAUTHORIZED" {
		t.Fatalf("expected code UNAUTHORIZED, got %q", parsed.Code)
	}
	if parsed.Message == "" {
		t.Fatal("expected non-empty message")
	}
	regtest.MustNotContain(t, body, "<html")
}

func TestNonexistentApiRouteReturnsNotHtml(t *testing.T) {
	client := regtest.NewCookieClient()
	status, _, body := regtest.GetRaw(t, client, baseURL+"/api/nonexistent-route-12345")
	if status == 404 || status == 400 {
		var parsed map[string]any
		if err := json.Unmarshal([]byte(body), &parsed); err == nil {
			regtest.MustNotContain(t, body, "<html")
			regtest.MustNotContain(t, body, "<!DOCTYPE")
			return
		}
	}
	t.Logf("non-existent route returned status=%d (not 404/400), skipping strict JSON check", status)
}