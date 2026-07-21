package regression

import (
	"strings"
	"testing"

	"everything.dev/regression/http/internal/regtest"
)

type anonSignInResp struct {
	Token string `json:"token"`
	User  struct {
		ID          string `json:"id"`
		IsAnonymous bool   `json:"isAnonymous"`
	} `json:"user"`
}

type createApiKeyResp struct {
	ID          string              `json:"id"`
	Key         string              `json:"key"`
	Name        string              `json:"name"`
	Permissions map[string][]string `json:"permissions"`
}

type deleteApiKeyResp struct {
	Success bool `json:"success"`
}

type thing struct {
	ThingID  string `json:"thingId"`
	PluginID string `json:"pluginId"`
	Type     string `json:"type"`
	Payload  struct {
		Kind   string `json:"kind"`
		Source string `json:"source"`
	} `json:"payload"`
}

func TestAnonymousApiKeyCanCreateAndReadThing(t *testing.T) {
	if regtest.Mode() == regtest.ModeProd {
		t.Skip("auth+create flow only in dev mode (prod is read-only)")
	}

	client := regtest.NewCookieClient()
	var apiKeyID string
	var apiKeySecret string
	var createdThingID string

	t.Run("unauthenticated_create_fails", func(t *testing.T) {
		resp := regtest.PostJSON(t, client, baseURL+"/api/things", map[string]any{
			"pluginId": "template",
			"payload":  map[string]string{"kind": "regression"},
		})
		regtest.MustStatus(t, resp, 401)
	})

	var anonUserID string
	t.Run("anonymous_sign_in", func(t *testing.T) {
		resp := regtest.PostJSONWithCookies(t, client, baseURL+"/api/auth/sign-in/anonymous", nil)
		regtest.MustStatus(t, resp, 200)

		var result anonSignInResp
		regtest.DecodeBody(t, resp, &result)

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

	t.Run("session_lookup", func(t *testing.T) {
		resp := regtest.PostJSONWithCookies(t, client, baseURL+"/api/auth/get-session", nil)
		regtest.MustStatus(t, resp, 200)

		var result struct {
			Session struct {
				ID     string `json:"id"`
				UserID string `json:"userId"`
			} `json:"session"`
			User struct {
				IsAnonymous bool `json:"isAnonymous"`
			} `json:"user"`
		}
		regtest.DecodeBody(t, resp, &result)

		if result.Session.ID == "" {
			t.Fatal("expected non-empty session id")
		}
		if result.Session.UserID != anonUserID {
			t.Fatalf("expected session userId '%s', got '%s'", anonUserID, result.Session.UserID)
		}
		if !result.User.IsAnonymous {
			t.Fatal("expected user.isAnonymous to be true")
		}
	})

	t.Run("api_key_create", func(t *testing.T) {
		resp := regtest.PostJSONWithCookies(t, client, baseURL+"/api/auth/api-key/create", map[string]any{
			"name": "regression api key",
			"permissions": map[string][]string{
				"things": {"create"},
			},
		})
		regtest.MustStatus(t, resp, 200)

		var result createApiKeyResp
		regtest.DecodeBody(t, resp, &result)

		if result.ID == "" {
			t.Fatal("expected non-empty api key id")
		}
		if result.Key == "" {
			t.Fatal("expected non-empty api key secret")
		}
		if result.Name != "regression api key" {
			t.Fatalf("expected name 'regression api key', got %q", result.Name)
		}
		apiKeyID = result.ID
		apiKeySecret = result.Key
	})

	t.Run("api_key_list_after_create", func(t *testing.T) {
		body, resp := regtest.GetText(t, client, baseURL+"/api/auth/api-key/list")
		regtest.MustStatus(t, resp, 200)
		regtest.MustContain(t, body, apiKeyID)
	})

	var createdThing thing
	t.Run("create_thing_with_api_key", func(t *testing.T) {
		resp := regtest.PostJSONWithKey(t, client, baseURL+"/api/things", map[string]any{
			"pluginId": "template",
			"payload": map[string]string{
				"kind":   "regression",
				"source": "api-key",
			},
		}, apiKeySecret)
		regtest.MustStatus(t, resp, 200)

		regtest.DecodeBody(t, resp, &createdThing)

		if !strings.HasPrefix(createdThing.ThingID, "thing_") {
			t.Fatalf("expected thingId to start with thing_, got %q", createdThing.ThingID)
		}
		if createdThing.PluginID != "template" {
			t.Fatalf("expected pluginId 'template', got %q", createdThing.PluginID)
		}
		if createdThing.Type != "template.regression" {
			t.Fatalf("expected type 'template.regression', got %q", createdThing.Type)
		}
		if createdThing.Payload.Kind != "regression" {
			t.Fatalf("expected payload.kind 'regression', got %q", createdThing.Payload.Kind)
		}
		createdThingID = createdThing.ThingID
	})

	t.Run("read_thing_back", func(t *testing.T) {
		var result thing
		resp := regtest.GetJSON(t, client, baseURL+"/api/things/"+createdThingID, &result)
		regtest.MustStatus(t, resp, 200)

		if result.ThingID != createdThingID {
			t.Fatalf("expected thingId %q, got %q", createdThingID, result.ThingID)
		}
		if result.PluginID != "template" {
			t.Fatalf("expected pluginId 'template', got %q", result.PluginID)
		}
		if result.Type != createdThing.Type {
			t.Fatalf("expected type %q, got %q", createdThing.Type, result.Type)
		}
	})

	t.Run("delete_api_key", func(t *testing.T) {
		resp := regtest.PostJSONWithCookies(t, client, baseURL+"/api/auth/api-key/delete", map[string]any{
			"keyId": apiKeyID,
		})
		regtest.MustStatus(t, resp, 200)

		var result deleteApiKeyResp
		regtest.DecodeBody(t, resp, &result)

		if !result.Success {
			t.Fatal("expected success true")
		}
	})

	t.Run("deleted_key_fails", func(t *testing.T) {
		resp := regtest.PostJSONWithKey(t, client, baseURL+"/api/things", map[string]any{
			"pluginId": "template",
			"payload":  map[string]string{"kind": "regression"},
		}, apiKeySecret)
		if resp.StatusCode != 401 {
			t.Fatalf("expected 401 with deleted key, got %d", resp.StatusCode)
		}
	})

	t.Run("final_list_excludes_deleted", func(t *testing.T) {
		body, resp := regtest.GetText(t, client, baseURL+"/api/auth/api-key/list")
		regtest.MustStatus(t, resp, 200)
		if strings.Contains(body, apiKeyID) {
			t.Fatal("deleted api key should not appear in list")
		}
	})
}
