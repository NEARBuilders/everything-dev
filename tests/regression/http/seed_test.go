package regression

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"testing"

	"everything.dev/regression/http/internal/regtest"
)

func findReposRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "bos.config.json")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("bos.config.json not found in any parent directory")
		}
		dir = parent
	}
}

func writeCookies(client *http.Client, repoRoot string) error {
	u, _ := url.Parse("http://localhost:4100")
	cookies := client.Jar.Cookies(u)

	type cookieEntry struct {
		Name     string  `json:"name"`
		Value    string  `json:"value"`
		Domain   string  `json:"domain"`
		Path     string  `json:"path"`
		HttpOnly bool    `json:"httpOnly"`
		Secure   bool    `json:"secure"`
		SameSite *string `json:"sameSite,omitempty"`
	}

	sameSitePtr := func(s string) *string { return &s }

	entries := make([]cookieEntry, 0, len(cookies))
	for _, c := range cookies {
		var sameSite *string
		switch c.SameSite {
		case http.SameSiteLaxMode:
			sameSite = sameSitePtr("Lax")
		case http.SameSiteStrictMode:
			sameSite = sameSitePtr("Strict")
		case http.SameSiteNoneMode:
			sameSite = sameSitePtr("None")
		}
		domain := c.Domain
		if domain == "" {
			domain = "localhost"
		}
		path := c.Path
		if path == "" {
			path = "/"
		}
		entries = append(entries, cookieEntry{
			Name:     c.Name,
			Value:    c.Value,
			Domain:   domain,
			Path:     path,
			HttpOnly: c.HttpOnly,
			Secure:   c.Secure,
			SameSite: sameSite,
		})
	}

	bosDir := filepath.Join(repoRoot, ".bos", "regression")
	if err := os.MkdirAll(bosDir, 0o755); err != nil {
		return fmt.Errorf("creating .bos/regression dir: %w", err)
	}

	path := filepath.Join(bosDir, "cookies.json")
	data, err := json.MarshalIndent(entries, "", "  ")
	if err != nil {
		return fmt.Errorf("marshaling cookies: %w", err)
	}
	return os.WriteFile(path, data, 0o644)
}

func TestSeedRegressionData(t *testing.T) {
	client := regtest.NewCookieClient()
	repoRoot, err := findReposRoot()
	if err != nil {
		t.Fatalf("finding repo root: %v", err)
	}

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
			"Origin": "http://localhost:4100",
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
			"Origin": "http://localhost:4100",
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
			"Origin": "http://localhost:4100",
		})
		regtest.MustStatus(t, status, 200, body)
	})

	// Step 4: Create a tenant in org A
	var tenantID string
	tenantSubdomain := fmt.Sprintf("regression-tenant-%d", os.Getpid())

	t.Run("create_tenant", func(t *testing.T) {
		status, _, body := regtest.PostJSON(t, client, baseURL+"/api/tenants", map[string]string{
			"subdomain": tenantSubdomain,
			"name":      "Regression Tenant",
			"accountId": fmt.Sprintf("%s.testnet", tenantSubdomain),
			"orgId":     orgAID,
		}, nil)
		if status != 200 {
			t.Fatalf("expected status 200, got %d. Body: %s", status, body)
		}
		var result struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal([]byte(body), &result); err != nil {
			t.Fatalf("decoding tenant response: %v\nBody: %s", err, body)
		}
		tenantID = result.ID
		if tenantID == "" {
			t.Fatal("expected non-empty tenant id")
		}
	})

	// Step 5: Write seed metadata for browser tests
	t.Run("write_seed_data", func(t *testing.T) {
		seedData := map[string]string{
			"orgAID":    orgAID,
			"orgBID":    orgBID,
			"orgAName":  orgAName,
			"orgBName":  orgBName,
			"tenantID":  tenantID,
			"subdomain": tenantSubdomain,
		}
		data, _ := json.MarshalIndent(seedData, "", "  ")

		bosDir := filepath.Join(repoRoot, ".bos", "regression")
		if err := os.MkdirAll(bosDir, 0o755); err != nil {
			t.Fatalf("creating .bos/regression dir: %v", err)
		}
		path := filepath.Join(bosDir, "seed.json")
		if err := os.WriteFile(path, data, 0o644); err != nil {
			t.Fatalf("writing seed data: %v", err)
		}
	})

	// Step 6: Write cookies for browser test injection
	t.Run("write_cookies", func(t *testing.T) {
		if err := writeCookies(client, repoRoot); err != nil {
			t.Fatalf("writing cookies: %v", err)
		}
	})
}
