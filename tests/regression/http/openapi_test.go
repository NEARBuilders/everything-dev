package regression

import (
	"encoding/json"
	"strings"
	"testing"

	"everything.dev/regression/http/internal/regtest"
)

type openAPIDoc struct {
	OpenAPI string `json:"openapi"`
	Info    struct {
		Title   string `json:"title"`
		Version string `json:"version"`
	} `json:"info"`
	Paths map[string]any `json:"paths"`
}

func TestOpenAPISurface(t *testing.T) {
	client := regtest.NewCookieClient()

	t.Run("reference_html", func(t *testing.T) {
		body, resp := regtest.GetText(t, client, baseURL+"/api")
		regtest.MustStatus(t, resp, 200)
		regtest.MustHeaderContains(t, resp, "Content-Type", "text/html")

		if !strings.Contains(body, "Scalar") && !strings.Contains(body, "swagger") {
			t.Fatal("expected API reference HTML to contain Scalar or Swagger UI markers")
		}
		if !strings.Contains(body, "spec.json") {
			t.Fatal("expected reference HTML to reference spec.json")
		}
	})

	t.Run("spec_json", func(t *testing.T) {
		var doc openAPIDoc
		resp := regtest.GetJSON(t, client, baseURL+"/api/spec.json", &doc)

		regtest.MustStatus(t, resp, 200)
		regtest.MustHeaderContains(t, resp, "Content-Type", "application/json")

		if doc.OpenAPI == "" {
			t.Fatal("openapi field is empty")
		}
		if doc.Info.Title == "" {
			t.Fatal("info.title is empty")
		}
		if doc.Info.Version != "1.0.0" {
			t.Fatalf("expected version 1.0.0, got %q", doc.Info.Version)
		}

		checkPath := func(path string) {
			if _, ok := doc.Paths[path]; !ok {
				t.Fatalf("expected path %s in OpenAPI spec", path)
			}
		}

		checkPath("/ping")
		checkPath("/things")
		checkPath("/things/{thingId}")
		checkPath("/v1/registry/status")
	})
}

func TestOpenAPIDocValidJSON(t *testing.T) {
	client := regtest.NewCookieClient()
	body, resp := regtest.GetText(t, client, baseURL+"/api/spec.json")
	regtest.MustStatus(t, resp, 200)

	var raw json.RawMessage
	if err := json.Unmarshal([]byte(body), &raw); err != nil {
		t.Fatalf("spec.json is not valid JSON: %v", err)
	}
}
