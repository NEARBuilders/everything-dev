package regression

import (
	"encoding/json"
	"fmt"
	"os"
	"testing"

	"everything.dev/regression/http/internal/regtest"
)

func TestSeedRegressionData(t *testing.T) {
	client := regtest.NewCookieClient()

	// Step 1: Sign in anonymously
	t.Run("sign_in", func(t *testing.T) {
		status, _, body := regtest.PostEmpty(t, client, baseURL+"/api/auth/sign-in/anonymous")
		regtest.MustStatus(t, status, 200, body)
	})

	// Step 2: Create two orgs
	var orgAID, orgBID string
	orgAName := fmt.Sprintf("regression-org-a-%d", os.Getpid())
	orgBName := fmt.Sprintf("regression-org-b-%d", os.Getpid())

	t.Run("create_org_a", func(t *testing.T) {
		status, _, body := regtest.PostJSON(t, client, baseURL+"/api/auth/organization/create", map[string]string{
			"name": orgAName,
			"slug": orgAName,
		}, map[string]string{
			"Origin": regtest.Origin(),
		})
		regtest.MustStatus(t, status, 200, body)
		var result struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal([]byte(body), &result); err != nil {
			t.Fatalf("decoding org response: %v\nBody: %s", err, body)
		}
		orgAID = result.ID
		if orgAID == "" {
			t.Fatal("expected non-empty org id")
		}
	})

	t.Run("create_org_b", func(t *testing.T) {
		status, _, body := regtest.PostJSON(t, client, baseURL+"/api/auth/organization/create", map[string]string{
			"name": orgBName,
			"slug": orgBName,
		}, map[string]string{
			"Origin": regtest.Origin(),
		})
		regtest.MustStatus(t, status, 200, body)
		var result struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal([]byte(body), &result); err != nil {
			t.Fatalf("decoding org response: %v\nBody: %s", err, body)
		}
		orgBID = result.ID
		if orgBID == "" {
			t.Fatal("expected non-empty org id")
		}
	})

	// Step 3: Set org A active
	t.Run("set_active_org", func(t *testing.T) {
		status, _, body := regtest.PostJSON(t, client, baseURL+"/api/auth/organization/set-active", map[string]string{
			"organizationId": orgAID,
		}, map[string]string{
			"Origin": regtest.Origin(),
		})
		regtest.MustStatus(t, status, 200, body)
	})

	// Step 4: Seed a tenant. Tenant creation via the API is admin-gated in
	// some forks (platform-admin + DAO membership), so the harness seeds the
	// row directly and works with whatever the config allows.
	t.Run("create_tenant", func(t *testing.T) {
		tenantID := regtest.SeedTenant(t, map[string]any{
			"subdomain": fmt.Sprintf("regression-tenant-%d", os.Getpid()),
			"name":      "Regression Tenant",
			"accountId": fmt.Sprintf("regression-tenant-%d.testnet", os.Getpid()),
			"orgId":     orgAID,
		})
		if tenantID == "" {
			t.Fatal("expected non-empty tenant id")
		}
	})
}
