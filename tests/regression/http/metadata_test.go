package regression

import (
	"testing"

	"everything.dev/regression/http/internal/regtest"
)

func TestRootMetadata(t *testing.T) {
	client := regtest.NewCookieClient()
	status, _, body := regtest.GetRaw(t, client, baseURL+"/")
	regtest.MustStatus(t, status, 200, body)

	if !regtest.HTMLContainsTitle(body) {
		t.Fatal("root HTML missing <title> tag")
	}

	if !regtest.HTMLContainsRuntimeConfig(body) {
		t.Fatal("root HTML missing window.__RUNTIME_CONFIG__")
	}

	if !regtest.ContainsJSON(body, "apiBase", "rpcBase") {
		t.Fatal("root HTML missing apiBase or rpcBase in runtime config")
	}
}

func TestRouteMetadata(t *testing.T) {
	client := regtest.NewCookieClient()
	status, _, body := regtest.GetRaw(t, client, baseURL+"/apps")
	regtest.MustStatus(t, status, 200, body)

	if !regtest.HTMLContainsTitle(body) {
		t.Fatal("route HTML missing <title> tag")
	}
}
