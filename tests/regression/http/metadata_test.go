package regression

import (
	"testing"

	"everything.dev/regression/http/internal/regtest"
)

func TestRootMetadata(t *testing.T) {
	client := regtest.NewCookieClient()
	body, resp := regtest.GetText(t, client, baseURL+"/")
	regtest.MustStatus(t, resp, 200)

	if !regtest.HTMLContainsTitle(body) {
		t.Fatal("root HTML missing <title> tag")
	}

	if !regtest.HTMLContainsMetaName(body, "description") {
		t.Fatal("root HTML missing description meta")
	}

	if !regtest.HTMLContainsMetaProperty(body, "og:title") {
		t.Fatal("root HTML missing og:title")
	}

	if !regtest.HTMLContainsMetaProperty(body, "og:description") {
		t.Fatal("root HTML missing og:description")
	}

	if !regtest.HTMLContainsManifest(body) {
		t.Fatal("root HTML missing manifest link")
	}

	if !regtest.HTMLContainsRuntimeConfig(body) {
		t.Fatal("root HTML missing window.__RUNTIME_CONFIG__")
	}

	if !regtest.ContainsJSON(body, "apiBase", "rpcBase") {
		t.Fatal("root HTML missing apiBase or rpcBase in runtime config")
	}
}
