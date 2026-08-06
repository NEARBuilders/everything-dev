package regtest

import (
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

type Process struct {
	Cmd     *exec.Cmd
	BaseURL string
	done    chan struct{}
}

func Start(t interface{ Fatalf(string, ...any) }) *Process {
	mode := Mode()

	workdir, err := findRepoRoot()
	if err != nil {
		if t != nil {
			t.Fatalf("finding repo root: %v", err)
		} else {
			log.Printf("ERROR: finding repo root: %v", err)
		}
		return nil
	}

	killStalePorts(workdir)

	cmd := exec.Command("bun", "run", "regression:start:"+string(mode))
	cmd.Dir = workdir
	cmd.Env = os.Environ()
	cmd.Env = append(cmd.Env,
		"API_DATABASE_URL=postgres://everythingdev:everythingdev@127.0.0.1:5432/api_db",
		"AUTH_DATABASE_URL=postgres://everythingdev:everythingdev@127.0.0.1:5433/auth_db",
		"TEMPLATE_DATABASE_URL=postgres://everythingdev:everythingdev@127.0.0.1:5434/template_db",
		"CORS_ORIGIN=http://localhost:4100",
		"BETTER_AUTH_SECRET=regression-test-secret-do-not-use-in-production",
		"CI=true",
		"RATE_LIMIT_WINDOW_MS=1000",
		"RATE_LIMIT_MAX=100",
		"BODY_LIMIT_MAX=65536",
	)

	logDir := filepath.Join(workdir, ".bos", "logs")
	os.MkdirAll(logDir, 0755)
	logFile := filepath.Join(logDir, "regression-"+string(mode)+".log")
	f, err := os.Create(logFile)
	if err != nil {
		if t != nil {
			t.Fatalf("creating log file: %v", err)
		} else {
			log.Printf("ERROR: creating log file: %v", err)
		}
		return nil
	}
	cmd.Stdout = f
	cmd.Stderr = f

	if err := cmd.Start(); err != nil {
		f.Close()
		if t != nil {
			t.Fatalf("starting regression target: %v", err)
		} else {
			log.Printf("ERROR: starting regression target: %v", err)
		}
		return nil
	}

	p := &Process{
		Cmd:     cmd,
		BaseURL: BaseURL(),
		done:    make(chan struct{}),
	}

	go func() {
		cmd.Wait()
		f.Close()
		close(p.done)
	}()

	return p
}

func (p *Process) Stop() {
	if p.Cmd == nil || p.Cmd.Process == nil {
		return
	}
	p.Cmd.Process.Signal(os.Interrupt)
	select {
	case <-p.done:
	case <-time.After(10 * time.Second):
		p.Cmd.Process.Kill()
		<-p.done
	}
}

func ResetTemplateDatabase() {
	cmd := exec.Command("docker", "exec", "dev.everything.near-postgres-template",
		"psql", "-U", "everythingdev", "-d", "template_db",
		"-c", "DROP TABLE IF EXISTS things, drizzle_migrations CASCADE")
	if err := cmd.Run(); err != nil {
		log.Printf("WARN: failed to reset template database (container may not be running): %v", err)
	}
}

func killStalePorts(workdir string) {
	ports := []string{"4100", "4101", "4102", "4103", "4110", "4111"}
	for _, port := range ports {
		exec.Command("sh", "-c", "lsof -ti:"+port+" | xargs kill -9 2>/dev/null || true").Run()
	}
	time.Sleep(500 * time.Millisecond)
}

func findRepoRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "bos.config.json")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", os.ErrNotExist
		}
		dir = parent
	}
}
