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

func GetRaw(t *testing.T, client *http.Client, url string) (int, http.Header, string) {
	t.Helper()
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		t.Fatalf("creating GET request: %v", err)
	}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("reading %s: %v", url, err)
	}
	return resp.StatusCode, resp.Header.Clone(), string(body)
}

func GetJSON(t *testing.T, client *http.Client, url string, target any) (int, http.Header) {
	t.Helper()
	status, headers, body := GetRaw(t, client, url)
	if err := json.Unmarshal([]byte(body), target); err != nil {
		t.Fatalf("decoding JSON from %s: %v\nBody: %s", url, err, body)
	}
	return status, headers
}

func GetWithOrigin(t *testing.T, client *http.Client, url string) (int, http.Header, string) {
	t.Helper()
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		t.Fatalf("creating GET request: %v", err)
	}
	req.Header.Set("Origin", "http://localhost:4100")
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("reading %s: %v", url, err)
	}
	return resp.StatusCode, resp.Header.Clone(), string(body)
}

func PostEmpty(t *testing.T, client *http.Client, url string) (int, http.Header, string) {
	t.Helper()
	req, err := http.NewRequest("POST", url, strings.NewReader("{}"))
	if err != nil {
		t.Fatalf("creating POST request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("POST %s: %v", url, err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("reading %s: %v", url, err)
	}
	return resp.StatusCode, resp.Header.Clone(), string(body)
}

func PostJSON(t *testing.T, client *http.Client, url string, body any, extraHeaders map[string]string) (int, http.Header, string) {
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
	req.Header.Set("Content-Type", "application/json")
	for k, v := range extraHeaders {
		req.Header.Set(k, v)
	}

	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("POST %s: %v", url, err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("reading %s: %v", url, err)
	}
	return resp.StatusCode, resp.Header.Clone(), string(data)
}

func MustStatus(t *testing.T, status int, expected int, body string) {
	t.Helper()
	if status != expected {
		t.Fatalf("expected status %d, got %d. Body: %s", expected, status, body)
	}
}

func MustHeaderContains(t *testing.T, headers http.Header, key, substr string) {
	t.Helper()
	val := headers.Get(key)
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

func ContainsJSON(body string, keys ...string) bool {
	for _, key := range keys {
		if !strings.Contains(body, `"`+key+`"`) {
			return false
		}
	}
	return true
}
