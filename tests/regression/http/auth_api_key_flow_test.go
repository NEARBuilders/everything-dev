package regression

import (
	"encoding/json"
	"testing"

	"everything.dev/regression/http/internal/regtest"
)

func TestAnonymousSessionCanCreateAndReadThing(t *testing.T) {
	client := regtest.NewCookieClient()

	// Step 1: Unauthenticated create should fail
	t.Run("unauthenticated_create_fails", func(t *testing.T) {
		status, _, body := regtest.PostJSON(t, client, baseURL+"/api/things", map[string]any{
			"thingId": "regression-unauth",
			"payload": map[string]string{"kind": "regression"},
		}, nil)
		regtest.MustStatus(t, status, 401, body)
	})

	// Step 2: Anonymous sign-in
	var anonUserID string
	t.Run("anonymous_sign_in", func(t *testing.T) {
		status, _, body := regtest.PostEmpty(t, client, baseURL+"/api/auth/sign-in/anonymous")
		regtest.MustStatus(t, status, 200, body)

		var result struct {
			Token string `json:"token"`
			User  struct {
				ID          string `json:"id"`
				IsAnonymous bool   `json:"isAnonymous"`
			} `json:"user"`
		}
		if err := json.Unmarshal([]byte(body), &result); err != nil {
			t.Fatalf("decoding sign-in response: %v\nBody: %s", err, body)
		}

		if result.Token == "" {
			t.Fatal("expected non-empty token")
		}
		if result.User.ID == "" {
			t.Fatal("expected non-empty user.id")
		}
		if !result.User.IsAnonymous {
			t.Fatal("expected user.isAnonymous to be true")
		}
		anonUserID = result.User.ID
	})

	// Step 3: Session lookup via GET (GET bypasses host CSRF, Origin satisifies Better Auth)
	t.Run("session_lookup", func(t *testing.T) {
		status, _, body := regtest.GetWithOrigin(t, client, baseURL+"/api/auth/get-session")
		regtest.MustStatus(t, status, 200, body)

		var result struct {
			Session struct {
				ID     string `json:"id"`
				UserID string `json:"userId"`
			} `json:"session"`
			User struct {
				IsAnonymous bool `json:"isAnonymous"`
			} `json:"user"`
		}
		if err := json.Unmarshal([]byte(body), &result); err != nil {
			t.Fatalf("decoding session response: %v\nBody: %s", err, body)
		}

		if result.Session.ID == "" {
			t.Fatal("expected non-empty session id")
		}
		if result.Session.UserID != anonUserID {
			t.Fatalf("expected session.userId '%s', got '%s'", anonUserID, result.Session.UserID)
		}
		if !result.User.IsAnonymous {
			t.Fatal("expected user.isAnonymous to be true")
		}
	})

	// Step 4: Create a thing with session auth
	var createdThingID string
	t.Run("create_thing_with_session", func(t *testing.T) {
		status, _, body := regtest.PostJSON(t, client, baseURL+"/api/things", map[string]any{
			"thingId": "regression-session",
			"payload": map[string]string{
				"kind":   "regression",
				"source": "session",
			},
		}, nil)
		regtest.MustStatus(t, status, 200, body)

		var result struct {
			ThingID  string `json:"thingId"`
			Type     string `json:"type"`
			Action   string `json:"action"`
		}
		if err := json.Unmarshal([]byte(body), &result); err != nil {
			t.Fatalf("decoding thing response: %v\nBody: %s", err, body)
		}

		if result.ThingID == "" {
			t.Fatal("expected non-empty thingId")
		}
		if result.Type != "template.regression" {
			t.Fatalf("expected type 'template.regression', got %q", result.Type)
		}
		if result.Action != "template.regression.created" {
			t.Fatalf("expected action 'template.regression.created', got %q", result.Action)
		}
		createdThingID = result.ThingID
	})

	// Step 5: Sign out (needs Origin header for Better Auth)
	t.Run("sign_out", func(t *testing.T) {
		status, _, body := regtest.PostJSON(t, client, baseURL+"/api/auth/sign-out", map[string]any{}, map[string]string{
			"Origin": "http://localhost:4100",
		})
		regtest.MustStatus(t, status, 200, body)
	})

	// Step 6: Verify session is gone after sign-out
	t.Run("session_gone_after_sign_out", func(t *testing.T) {
		status, _, body := regtest.GetWithOrigin(t, client, baseURL+"/api/auth/get-session")
		if status != 401 && status != 200 {
			t.Fatalf("expected 401 or 200, got %d. Body: %s", status, body)
		}
		if status == 200 {
			var result struct {
				Session any `json:"session"`
				User    any `json:"user"`
			}
			if err := json.Unmarshal([]byte(body), &result); err != nil {
				t.Fatalf("decoding session response: %v\nBody: %s", err, body)
			}
			if result.Session != nil || result.User != nil {
				t.Fatal("expected session and user to be null after sign-out")
			}
		}
	})

	// Step 7: Read thing back via public API
	t.Run("read_thing_back", func(t *testing.T) {
		status, _, body := regtest.GetRaw(t, client, baseURL+"/api/things/"+createdThingID)
		regtest.MustStatus(t, status, 200, body)

		var result struct {
			ThingID string `json:"thingId"`
			Type    string `json:"type"`
		}
		if err := json.Unmarshal([]byte(body), &result); err != nil {
			t.Fatalf("decoding thing response: %v\nBody: %s", err, body)
		}

		if result.ThingID != createdThingID {
			t.Fatalf("expected thingId %q, got %q", createdThingID, result.ThingID)
		}
		if result.Type != "template.regression" {
			t.Fatalf("expected type 'template.regression', got %q", result.Type)
		}
	})
}
