package regression

import (
	"encoding/json"
	"os"
	"testing"

	"everything.dev/regression/http/internal/regtest"
)

var baseURL string

func TestMain(m *testing.M) {
	proc := regtest.Start(nil)
	if proc == nil {
		os.Exit(1)
	}
	baseURL = proc.BaseURL
	regtest.WaitForReady(nil, baseURL)

	code := m.Run()
	proc.Stop()
	os.Exit(code)
}

func must[T any](t *testing.T, val T, err error) T {
	t.Helper()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	return val
}

func decode[T any](t *testing.T, body string) T {
	t.Helper()
	var v T
	if err := json.Unmarshal([]byte(body), &v); err != nil {
		t.Fatalf("decoding JSON: %v\nBody: %s", err, body)
	}
	return v
}
