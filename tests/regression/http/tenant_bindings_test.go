package regression

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"

	"everything.dev/regression/http/internal/regtest"
)

func TestTenantBindingsPublicEndpoint(t *testing.T) {
	client := regtest.NewCookieClient()

	t.Run("bindings_return_200_without_auth", func(t *testing.T) {
		status, _, body := regtest.GetRaw(t, client, baseURL+"/api/tenants/bindings")
		regtest.MustStatus(t, status, 200, body)
	})

	var bindings []struct {
		Hostname              string `json:"hostname"`
		AccountID             string `json:"accountId"`
		AllowUiOverrides      bool   `json:"allowUiOverrides"`
		AllowBackendOverrides bool   `json:"allowBackendOverrides"`
		AllowSsr              bool   `json:"allowSsr"`
		Status                string `json:"status"`
	}
	t.Run("bindings_decode_as_array", func(t *testing.T) {
		status, _, body := regtest.GetRaw(t, client, baseURL+"/api/tenants/bindings")
		regtest.MustStatus(t, status, 200, body)
		if err := json.Unmarshal([]byte(body), &bindings); err != nil {
			t.Fatalf("decoding bindings response: %v\nBody: %s", err, body)
		}
	})

	t.Run("seeded_tenant_binding_present", func(t *testing.T) {
		var seeded *struct {
			Hostname              string `json:"hostname"`
			AccountID             string `json:"accountId"`
			AllowUiOverrides      bool   `json:"allowUiOverrides"`
			AllowBackendOverrides bool   `json:"allowBackendOverrides"`
			AllowSsr              bool   `json:"allowSsr"`
			Status                string `json:"status"`
		}
		for i := range bindings {
			if strings.HasPrefix(bindings[i].Hostname, "regression-tenant-") {
				seeded = &bindings[i]
				break
			}
		}
		if seeded == nil {
			t.Fatal("expected seeded tenant binding to be present")
		}
		if seeded.Status != "active" {
			t.Fatalf("expected seeded tenant status 'active', got %q", seeded.Status)
		}
		if seeded.AccountID != fmt.Sprintf("%s.testnet", seeded.Hostname) {
			t.Fatalf("expected account id derived from hostname, got %q", seeded.AccountID)
		}

		// The seeded tenant uses the default permission columns.
		if !seeded.AllowUiOverrides {
			t.Fatal("expected allowUiOverrides to default to true")
		}
		if seeded.AllowBackendOverrides {
			t.Fatal("expected allowBackendOverrides to default to false")
		}
		if seeded.AllowSsr {
			t.Fatal("expected allowSsr to default to false")
		}
	})
}

func TestTenantBindingsReflectAllowFlags(t *testing.T) {
	client := regtest.NewCookieClient()

	t.Run("sign_in", func(t *testing.T) {
		status, _, body := regtest.PostEmpty(t, client, baseURL+"/api/auth/sign-in/anonymous")
		regtest.MustStatus(t, status, 200, body)
	})

	orgName := fmt.Sprintf("regression-flags-org-%d", os.Getpid())
	t.Run("create_org", func(t *testing.T) {
		status, _, body := regtest.PostJSON(t, client, baseURL+"/api/auth/organization/create", map[string]string{
			"name": orgName,
			"slug": orgName,
		}, map[string]string{
			"Origin": "http://localhost:4100",
		})
		regtest.MustStatus(t, status, 200, body)
		var result struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal([]byte(body), &result); err != nil {
			t.Fatalf("decoding org response: %v\nBody: %s", err, body)
		}
		if result.ID == "" {
			t.Fatal("expected non-empty org id")
		}

		status, _, body = regtest.PostJSON(t, client, baseURL+"/api/auth/organization/set-active", map[string]string{
			"organizationId": result.ID,
		}, map[string]string{
			"Origin": "http://localhost:4100",
		})
		regtest.MustStatus(t, status, 200, body)
	})

	subdomain := fmt.Sprintf("regression-flags-%d", os.Getpid())
	t.Run("create_tenant_with_explicit_flags", func(t *testing.T) {
		status, _, body := regtest.PostJSON(t, client, baseURL+"/api/tenants", map[string]any{
			"subdomain":             subdomain,
			"name":                  "Flags Tenant",
			"accountId":             fmt.Sprintf("%s.testnet", subdomain),
			"allowUiOverrides":      false,
			"allowBackendOverrides": true,
			"allowSsr":              true,
		}, nil)
		regtest.MustStatus(t, status, 200, body)

		var result struct {
			ID                    string `json:"id"`
			AllowUiOverrides      bool   `json:"allowUiOverrides"`
			AllowBackendOverrides bool   `json:"allowBackendOverrides"`
			AllowSsr              bool   `json:"allowSsr"`
		}
		if err := json.Unmarshal([]byte(body), &result); err != nil {
			t.Fatalf("decoding tenant response: %v\nBody: %s", err, body)
		}
		if result.ID == "" {
			t.Fatal("expected non-empty tenant id")
		}
		if result.AllowUiOverrides {
			t.Fatal("expected allowUiOverrides to be false")
		}
		if !result.AllowBackendOverrides {
			t.Fatal("expected allowBackendOverrides to be true")
		}
		if !result.AllowSsr {
			t.Fatal("expected allowSsr to be true")
		}
	})

	t.Run("bindings_reflect_flags", func(t *testing.T) {
		status, _, body := regtest.GetRaw(t, client, baseURL+"/api/tenants/bindings")
		regtest.MustStatus(t, status, 200, body)

		var bindings []struct {
			Hostname              string `json:"hostname"`
			AllowUiOverrides      bool   `json:"allowUiOverrides"`
			AllowBackendOverrides bool   `json:"allowBackendOverrides"`
			AllowSsr              bool   `json:"allowSsr"`
		}
		if err := json.Unmarshal([]byte(body), &bindings); err != nil {
			t.Fatalf("decoding bindings response: %v\nBody: %s", err, body)
		}

		var found *struct {
			Hostname              string `json:"hostname"`
			AllowUiOverrides      bool   `json:"allowUiOverrides"`
			AllowBackendOverrides bool   `json:"allowBackendOverrides"`
			AllowSsr              bool   `json:"allowSsr"`
		}
		for i := range bindings {
			if bindings[i].Hostname == subdomain {
				found = &bindings[i]
				break
			}
		}
		if found == nil {
			t.Fatal("expected created tenant to appear in bindings")
		}
		if found.AllowUiOverrides {
			t.Fatal("expected binding allowUiOverrides to be false")
		}
		if !found.AllowBackendOverrides {
			t.Fatal("expected binding allowBackendOverrides to be true")
		}
		if !found.AllowSsr {
			t.Fatal("expected binding allowSsr to be true")
		}
	})
}
