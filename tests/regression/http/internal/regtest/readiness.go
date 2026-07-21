package regtest

import (
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

		resp, err := client.Get(baseURL + "/health")
		if err == nil {
			body, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			if resp.StatusCode == 200 && strings.TrimSpace(string(body)) == "OK" {
				log.Printf("Ready after %v", time.Since(start).Round(time.Millisecond))
				return
			}
		}
	}

	msg := "Target did not become ready within " + deadline.String()
	if f != nil {
		f.Fatalf(msg)
	} else {
		log.Fatalf(msg)
	}
}
