package regression

import (
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
