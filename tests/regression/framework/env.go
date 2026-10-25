package framework

import (
	"bufio"
	"os"
	"strings"
)

// testEnvKeys are the variables the dev stack must inherit from .env.test so
// the stack uses the regression auth secret (regression-env.mjs convention:
// exported vars outrank .env via the CLI's shell-env tier).
var requiredTestEnvKeys = []string{"BETTER_AUTH_SECRET"}

func parseDotenvFile(path string) (map[string]string, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	values := map[string]string{}
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		value = strings.Trim(value, `"'`)
		values[key] = value
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return values, nil
}

// childEnv builds the spawned CLI's environment: the test runner's env, minus
// any key we override, plus the overrides (the neutralized substrate URLs,
// .env.test's secret, the port-derived origins, and the ephemeral-run
// guards).
func childEnv(overrides map[string]string) []string {
	base := os.Environ()
	filtered := base[:0:0]
	for _, entry := range base {
		key, _, _ := strings.Cut(entry, "=")
		if _, hit := overrides[key]; hit {
			continue
		}
		filtered = append(filtered, entry)
	}
	for key, value := range overrides {
		filtered = append(filtered, key+"="+value)
	}
	return filtered
}

// envOverridesFromDotenv builds the framework's env overrides: every
// substrate URL key seen in .env.test or a developer's local .env is exported
// EMPTY. The CLI's dotenv load never overrides existing keys, so the empty
// export wins over both files; the infra planner treats an empty URL as
// not-supplied (zero-config dev), so no conventional database URLs are
// generated, the preflight has nothing to probe, compose stays down, and each
// stack boots on its own ephemeral pglite (plugin.dev.ts's `|| pglite`
// fallback). Required keys pass through with their .env.test values.
func envOverridesFromDotenv(testEnv, devEnv map[string]string) map[string]string {
	overrides := map[string]string{}
	for _, values := range []map[string]string{testEnv, devEnv} {
		for key := range values {
			if strings.HasSuffix(key, "_DATABASE_URL") || strings.HasSuffix(key, "_REDIS_URL") {
				overrides[key] = ""
			}
		}
	}
	for _, key := range requiredTestEnvKeys {
		if value, ok := testEnv[key]; ok {
			overrides[key] = value
		}
	}
	return overrides
}
