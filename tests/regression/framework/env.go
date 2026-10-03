package framework

import (
	"bufio"
	"os"
	"strings"
)

// testEnvKeys are the variables the dev stack must inherit from .env.test so
// the stack never touches the dev databases (regression-env.mjs convention:
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
// any key we override, plus the overrides (.env.test's DB URLs and secret, the
// port-derived origins, and the ephemeral-run guards).
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

// envOverridesFromDotenv picks the stack-relevant subset of a dotenv file:
// every *_DATABASE_URL, plus the explicitly required keys.
func envOverridesFromDotenv(values map[string]string) map[string]string {
	overrides := map[string]string{}
	for key, value := range values {
		if strings.HasSuffix(key, "_DATABASE_URL") {
			overrides[key] = value
		}
	}
	for _, key := range requiredTestEnvKeys {
		if value, ok := values[key]; ok {
			overrides[key] = value
		}
	}
	return overrides
}
