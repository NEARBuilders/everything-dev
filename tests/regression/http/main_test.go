package regression

import (
	"encoding/json"
	"log"
	"os"
	"testing"

	"everything.dev/regression/http/internal/regtest"
)

var baseURL string

func TestMain(m *testing.M) {
	log.Println("Starting regression test server...")
	proc := regtest.Start(nil)
	if proc == nil {
		log.Println("ERROR: Start returned nil (server failed to start)")
		os.Exit(1)
	}
	baseURL = proc.BaseURL
	log.Printf("Base URL: %s", baseURL)
	regtest.WaitForReady(nil, baseURL)

	regtest.TruncateThings()

	log.Println("Server ready, running tests...")
	code := m.Run()
	log.Println("Tests complete, stopping server...")
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
