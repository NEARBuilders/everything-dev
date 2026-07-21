package regtest

import (
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
		}
		return nil
	}

	cmd := exec.Command("bun", "run", "regression:start:"+string(mode))
	cmd.Dir = workdir
	cmd.Env = os.Environ()
	cmd.Env = append(cmd.Env,
		"API_DATABASE_URL=postgres://everythingdev:everythingdev@127.0.0.1:5432/api_db",
		"AUTH_DATABASE_URL=postgres://everythingdev:everythingdev@127.0.0.1:5433/auth_db",
		"CORS_ORIGIN=http://127.0.0.1:4100",
		"CI=true",
	)

	logDir := filepath.Join(workdir, ".bos", "logs")
	os.MkdirAll(logDir, 0755)
	logFile := filepath.Join(logDir, "regression-"+string(mode)+".log")
	f, err := os.Create(logFile)
	if err != nil {
		if t != nil {
			t.Fatalf("creating log file: %v", err)
		}
		return nil
	}
	cmd.Stdout = f
	cmd.Stderr = f

	if err := cmd.Start(); err != nil {
		f.Close()
		if t != nil {
			t.Fatalf("starting regression target: %v", err)
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
