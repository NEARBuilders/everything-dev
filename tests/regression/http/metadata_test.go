package regression

import (
	"strings"
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

func TestProfileMetadata(t *testing.T) {
	const accountID = "root.near"

	client := regtest.NewCookieClient()
	status, _, body := regtest.GetRaw(t, client, baseURL+"/"+accountID)
	regtest.MustStatus(t, status, 200, body)

	if !regtest.HTMLContainsTitle(body) {
		t.Fatal("profile HTML missing <title> tag")
	}
	if !strings.Contains(body, accountID) {
		t.Fatalf("profile HTML missing account id %q", accountID)
	}

	for _, property := range []string{"og:title", "og:description", "og:type"} {
		if !regtest.HTMLContainsMetaProperty(body, property) {
			t.Fatalf("profile HTML missing %s meta property", property)
		}
	}

	for _, name := range []string{"twitter:card", "twitter:title", "twitter:description"} {
		if !regtest.HTMLContainsMetaName(body, name) {
			t.Fatalf("profile HTML missing %s meta name", name)
		}
	}
}
