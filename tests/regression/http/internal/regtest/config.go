package regtest

import (
	"encoding/json"
	"fmt"
	"log"
	"os/exec"
	"sync"
)// Config carries everything the harness derives from repo state
// (authored config + .env + ambient env). It replaces the previously
// hardcoded upstream URLs/ports so the suite works in any fork.
type Config struct {
	BaseURL    string            `json:"baseUrl"`
	DBURLs     map[string]string `json:"dbUrls"`
	AuthSecret string            `json:"authSecret"`
	StalePorts []int             `json:"stalePorts"`
}

var (
	configOnce sync.Once
	configVal  *Config
	configErr  error
)

// EnvPath is resolved relative to the repo root at load time. The helper
// runs through node directly (the repo's runtime since ADR 0026).
func envHelperArgs() []string {
	return []string{"tests/regression/lib/regression-env.mjs", "--json"}
}

// LoadConfig resolves the regression environment once per process.
func LoadConfig() *Config {
	configOnce.Do(func() {
		workdir, err := findRepoRoot()
		if err != nil {
			configErr = fmt.Errorf("finding repo root: %w", err)
			return
		}
		cmd := exec.Command("node", envHelperArgs()...)
		cmd.Dir = workdir
		out, err := cmd.Output()
		if err != nil {
			configErr = fmt.Errorf("running regression-env helper (node tests/regression/lib/regression-env.mjs): %w", err)
			return
		}
		var cfg Config
		if err := json.Unmarshal(out, &cfg); err != nil {
			configErr = fmt.Errorf("decoding regression-env JSON: %w", err)
			return
		}
		if cfg.BaseURL == "" {
			configErr = fmt.Errorf("regression-env helper returned empty baseUrl")
			return
		}
		configVal = &cfg
	})
	if configErr != nil {
		log.Fatalf("[regtest] %v", configErr)
	}
	return configVal
}

// RepoRoot returns the directory containing the authored config (bos.app.ts).
func RepoRoot() string {
	dir, err := findRepoRoot()
	if err != nil {
		log.Fatalf("[regtest] finding repo root: %v", err)
	}
	return dir
}
