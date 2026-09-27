package regtest

import (
	"encoding/json"
	"os/exec"
)

// SeedTenant inserts a tenant (+ primary domain binding) directly into the
// API database via the seed helper. Some forks gate POST /api/tenants behind
// platform-admin roles and on-chain DAO membership, so the harness seeds
// repo-state rows instead of calling the API.
func SeedTenant(t interface{ Fatalf(string, ...any) }, input map[string]any) string {
	payload, err := json.Marshal(input)
	if err != nil {
		t.Fatalf("encoding seed tenant payload: %v", err)
	}
	cmd := exec.Command("bun", "tests/regression/lib/seed-tenant.mjs", string(payload))
	cmd.Dir = RepoRoot()
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("seeding tenant: %v\n%s", err, tail(string(out), 2000))
	}
	var result struct {
		ID     string `json:"id"`
		Reused bool   `json:"reused"`
	}
	if err := json.Unmarshal(out, &result); err != nil {
		t.Fatalf("decoding seed tenant output: %v\n%s", err, tail(string(out), 2000))
	}
	return result.ID
}
