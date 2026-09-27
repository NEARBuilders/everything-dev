package regtest

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

const readinessTimeoutDev  = 120 * time.Second
const readinessTimeoutProd = 120 * time.Second

type fatalf interface {
	Fatalf(string, ...any)
}

func WaitForReady(f fatalf, proc *Process) {
	mode := Mode()
	deadline := readinessTimeoutDev
	if mode == ModeStart {
		deadline = readinessTimeoutProd
	}
	baseURL := proc.BaseURL

	log.Printf("Waiting for %s to be ready at %s (timeout: %v)", mode, baseURL, deadline)

	client := &http.Client{Timeout: 3 * time.Second}
	start := time.Now()
	backoff := 500 * time.Millisecond

	for time.Since(start) < deadline {
		select {
		case <-proc.Done():
			reportEarlyExit(f, proc)
			return
		default:
		}

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

	dumpLogTail(proc.LogPath)
	proc.Stop()
	msg := "Target did not become ready within " + deadline.String()
	if f != nil {
		f.Fatalf(msg)
	} else {
		log.Fatalf(msg)
	}
}

// reportEarlyExit turns a crashed target into an immediate, actionable
// failure instead of waiting out the full readiness timeout.
func reportEarlyExit(f fatalf, proc *Process) {
	dumpLogTail(proc.LogPath)
	proc.Stop()
	msg := "Target process exited before becoming ready (log tail above)"
	if f != nil {
		f.Fatalf(msg)
	} else {
		log.Fatalf(msg)
	}
}

// dumpLogTail prints the end of the dev log so the real boot error is
// visible in the test output.
func dumpLogTail(logPath string) {
	if logPath == "" {
		return
	}
	data, err := os.ReadFile(logPath)
	if err != nil {
		log.Printf("(could not read dev log %s: %v)", logPath, err)
		return
	}
	log.Printf("----- dev log tail (%s) -----\n%s----- end dev log tail -----", logPath, tail(string(data), 8000))
}

func tail(s string, max int) string {
	s = strings.TrimRight(s, "\n")
	if len(s) <= max {
		return s
	}
	return "…\n" + s[len(s)-max:]
}

func healthOK(client *http.Client, baseURL string) bool {
	resp, err := client.Get(baseURL + "/health")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return resp.StatusCode == 200 && StatusReady(string(body))
}

func apiHealthOK(client *http.Client, baseURL string) bool {
	resp, err := client.Get(baseURL + "/api/_health")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return resp.StatusCode == 200 && StatusReady(string(body))
}

// statusReady accepts both health contracts in the wild: the plain-text
// "OK" body and a JSON body like {"status":"ready"}. "degraded" and
// "failed" keep the readiness loop waiting.
// Exported so boot tests share the dual-contract check.
func StatusReady(body string) bool {
	trimmed := strings.TrimSpace(body)
	if trimmed == "OK" {
		return true
	}
	var result struct {
		Status string `json:"status"`
	}
	if err := json.Unmarshal([]byte(trimmed), &result); err != nil {
		return false
	}
	return result.Status == "ready" || result.Status == "ok"
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
