package regression

import (
	"io"
	"net/http"
	"testing"

	"everything.dev/regression/http/internal/regtest"
)

func TestCORSRootMetadata(t *testing.T) {
	client := regtest.NewCookieClient()

	t.Run("health_has_cors_origin_header", func(t *testing.T) {
		status, hdrs, body := regtest.GetRaw(t, client, baseURL+"/health")
		regtest.MustStatus(t, status, 200, body)

		if cors := hdrs.Get("Access-Control-Allow-Origin"); cors == "" {
			t.Fatal("expected Access-Control-Allow-Origin header on /health")
		}
	})

	t.Run("health_cors_with_origin_header", func(t *testing.T) {
		req, err := http.NewRequest("GET", baseURL+"/health", nil)
		if err != nil {
			t.Fatalf("creating request: %v", err)
		}
		req.Header.Set("Origin", "http://localhost:4100")

		resp, err := client.Do(req)
		if err != nil {
			t.Fatalf("GET /health with Origin: %v", err)
		}
		defer resp.Body.Close()
		io.ReadAll(resp.Body)

		cors := resp.Header.Get("Access-Control-Allow-Origin")
		if cors == "" {
			t.Fatal("expected Access-Control-Allow-Origin when Origin header is sent")
		}
	})

	t.Run("root_html_has_cors_header", func(t *testing.T) {
		status, hdrs, body := regtest.GetRaw(t, client, baseURL+"/")
		regtest.MustStatus(t, status, 200, body)

		if cors := hdrs.Get("Access-Control-Allow-Origin"); cors == "" {
			t.Fatal("expected Access-Control-Allow-Origin header on root page")
		}
	})
}
