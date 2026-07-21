package regtest

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"strings"
	"testing"
)

func NewCookieClient() *http.Client {
	jar, _ := cookiejar.New(nil)
	return &http.Client{Jar: jar}
}

func GetJSON(t *testing.T, client *http.Client, url string, target any) *http.Response {
	t.Helper()
	resp := doRequest(t, client, "GET", url, nil, nil)
	mustDecodeBody(t, resp, target)
	return resp
}

func GetText(t *testing.T, client *http.Client, url string) (string, *http.Response) {
	t.Helper()
	resp := doRequest(t, client, "GET", url, nil, nil)
	body := mustReadBody(t, resp)
	return body, resp
}

func PostJSON(t *testing.T, client *http.Client, url string, body any) *http.Response {
	t.Helper()
	return PostJSONWithCookies(t, client, url, body)
}

func PostJSONWithCookies(t *testing.T, client *http.Client, url string, body any) *http.Response {
	t.Helper()
	return postWithBody(t, client, url, body, nil)
}

func PostJSONWithKey(t *testing.T, client *http.Client, url string, body any, apiKey string) *http.Response {
	t.Helper()
	return postWithBody(t, client, url, body, map[string]string{
		"x-api-key": apiKey,
	})
}

func DecodeBody(t *testing.T, resp *http.Response, target any) {
	t.Helper()
	mustDecodeBody(t, resp, target)
}

func postWithBody(t *testing.T, client *http.Client, url string, body any, extraHeaders map[string]string) *http.Response {
	t.Helper()
	var reqBody io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshaling request body: %v", err)
		}
		reqBody = bytes.NewReader(data)
	}

	req, err := http.NewRequest("POST", url, reqBody)
	if err != nil {
		t.Fatalf("creating POST request: %v", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Origin", BaseURL())
	req.Header.Set("Referer", BaseURL()+"/")
	for k, v := range extraHeaders {
		req.Header.Set(k, v)
	}

	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("POST %s: %v", url, err)
	}
	return resp
}

func doRequest(t *testing.T, client *http.Client, method, url string, body io.Reader, extraHeaders map[string]string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(method, url, body)
	if err != nil {
		t.Fatalf("creating %s request: %v", method, err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range extraHeaders {
		req.Header.Set(k, v)
	}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, url, err)
	}
	return resp
}

func MustStatus(t *testing.T, resp *http.Response, expected int) {
	t.Helper()
	if resp.StatusCode != expected {
		body := mustReadBody(t, resp)
		t.Fatalf("expected status %d, got %d. Body: %s", expected, resp.StatusCode, body)
	}
}

func MustHeaderContains(t *testing.T, resp *http.Response, key, substr string) {
	t.Helper()
	val := resp.Header.Get(key)
	if !strings.Contains(val, substr) {
		t.Fatalf("expected header %s to contain %q, got %q", key, substr, val)
	}
}

func MustNotContain(t *testing.T, body, substr string) {
	t.Helper()
	if strings.Contains(body, substr) {
		t.Fatalf("expected body NOT to contain %q", substr)
	}
}

func MustContain(t *testing.T, body, substr string) {
	t.Helper()
	if !strings.Contains(body, substr) {
		t.Fatalf("expected body to contain %q\nBody: %s", substr, body)
	}
}

func mustDecodeBody(t *testing.T, resp *http.Response, target any) {
	t.Helper()
	body := mustReadBody(t, resp)
	if err := json.Unmarshal([]byte(body), target); err != nil {
		t.Fatalf("decoding JSON body: %v\nBody: %s", err, body)
	}
}

func mustReadBody(t *testing.T, resp *http.Response) string {
	t.Helper()
	data, err := io.ReadAll(resp.Body)
	resp.Body.Close()
	if err != nil {
		t.Fatalf("reading response body: %v", err)
	}
	return string(data)
}

func MustJSON(t *testing.T, v any) string {
	t.Helper()
	data, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshaling JSON: %v", err)
	}
	return string(data)
}

func ContainsJSON(body string, keys ...string) bool {
	for _, key := range keys {
		if !strings.Contains(body, `"`+key+`"`) {
			return false
		}
	}
	return true
}
