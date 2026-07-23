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
		status, headers, body := regtest.GetRaw(t, client, baseURL+"/api")
		regtest.MustStatus(t, status, 200, body)
		regtest.MustHeaderContains(t, headers, "Content-Type", "text/html")

		if !strings.Contains(body, "Scalar") && !strings.Contains(body, "swagger") {
			t.Fatal("expected API reference HTML to contain Scalar or Swagger UI markers")
		}
	})

	t.Run("spec_json", func(t *testing.T) {
		status, headers, body := regtest.GetRaw(t, client, baseURL+"/api/spec.json")
		regtest.MustStatus(t, status, 200, body)
		regtest.MustHeaderContains(t, headers, "Content-Type", "application/json")

		var doc openAPIDoc
		if err := json.Unmarshal([]byte(body), &doc); err != nil {
			t.Fatalf("spec.json not valid JSON: %v", err)
		}

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
	})
}

func TestOpenAPIDocValidJSON(t *testing.T) {
	client := regtest.NewCookieClient()
	status, _, body := regtest.GetRaw(t, client, baseURL+"/api/spec.json")
	regtest.MustStatus(t, status, 200, body)

	var raw json.RawMessage
	if err := json.Unmarshal([]byte(body), &raw); err != nil {
		t.Fatalf("spec.json is not valid JSON: %v", err)
	}
}
