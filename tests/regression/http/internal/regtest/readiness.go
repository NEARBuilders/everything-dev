package regtest

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
)

const readinessTimeoutDev  = 120 * time.Second
const readinessTimeoutProd = 120 * time.Second

type fatalf interface {
	Fatalf(string, ...any)
}

func WaitForReady(f fatalf, baseURL string) {
	mode := Mode()
	deadline := readinessTimeoutDev
	if mode == ModeProd {
		deadline = readinessTimeoutProd
	}

	log.Printf("Waiting for %s to be ready at %s (timeout: %v)", mode, baseURL, deadline)

	client := &http.Client{Timeout: 3 * time.Second}
	start := time.Now()
	backoff := 500 * time.Millisecond

	for time.Since(start) < deadline {
		time.Sleep(backoff)
		backoff = time.Duration(float64(backoff) * 1.5)
		if backoff > 5*time.Second {
			backoff = 5 * time.Second
		}

		if !healthOK(client, baseURL) {
			continue
		}
		if !apiHealthOK(client, baseURL) {
			continue
		}
		if !rootHTMLOK(client, baseURL) {
			continue
		}

		log.Printf("Ready after %v", time.Since(start).Round(time.Millisecond))
		return
	}

	msg := "Target did not become ready within " + deadline.String()
	if f != nil {
		f.Fatalf(msg)
	} else {
		log.Fatalf(msg)
	}
}

func healthOK(client *http.Client, baseURL string) bool {
	resp, err := client.Get(baseURL + "/health")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return resp.StatusCode == 200 && strings.TrimSpace(string(body)) == "OK"
}

func apiHealthOK(client *http.Client, baseURL string) bool {
	resp, err := client.Get(baseURL + "/api/_health")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return false
	}
	var result struct {
		Status string `json:"status"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return false
	}
	return result.Status == "ready"
}

func rootHTMLOK(client *http.Client, baseURL string) bool {
	resp, err := client.Get(baseURL + "/")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return false
	}
	ct := resp.Header.Get("Content-Type")
	return strings.Contains(ct, "text/html") && strings.Contains(string(body), "window.__RUNTIME_CONFIG__")
}
