package regtest

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"time"
)

type Process struct {
	Cmd     *exec.Cmd
	BaseURL string
	LogPath string
	done    chan struct{}
}

// Done reports when the target process exits.
func (p *Process) Done() <-chan struct{} { return p.done }

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

	cfg := LoadConfig()

	killStalePorts(cfg)

	cmd := exec.Command("bun", "run", ScriptName())
	cmd.Dir = workdir
	cmd.Env = buildTargetEnv(cfg)

	logPath := filepath.Join(workdir, ".bos", "logs", "regression-"+string(mode)+".log")
	if err := os.MkdirAll(filepath.Dir(logPath), 0o755); err != nil {
		if t != nil {
			t.Fatalf("creating log dir: %v", err)
		} else {
			log.Printf("ERROR: creating log dir: %v", err)
		}
		return nil
	}
	f, err := os.Create(logPath)
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
		BaseURL: cfg.BaseURL,
		LogPath: logPath,
		done:    make(chan struct{}),
	}

	go func() {
		cmd.Wait()
		f.Close()
		close(p.done)
	}()

	return p
}

// buildTargetEnv layers derived defaults under the ambient environment:
// anything already set (CI job env, developer shell) wins; the helper only
// fills the gaps so the suite works with whatever the repo configures.
func buildTargetEnv(cfg *Config) []string {
	env := os.Environ()
	setIfUnset := func(key, value string) {
		if _, exists := lookupEnv(env, key); !exists {
			env = append(env, key+"="+value)
		}
	}
	for key, value := range cfg.DBURLs {
		setIfUnset(key, value)
	}
	setIfUnset("CORS_ORIGIN", cfg.BaseURL)
	setIfUnset("BETTER_AUTH_SECRET", cfg.AuthSecret)
	setIfUnset("CI", "true")
	setIfUnset("RATE_LIMIT_WINDOW_MS", "1000")
	setIfUnset("RATE_LIMIT_MAX", "100")
	setIfUnset("BODY_LIMIT_MAX", "65536")
	return env
}

func lookupEnv(env []string, key string) (string, bool) {
	for _, entry := range env {
		if len(entry) > len(key)+1 && entry[:len(key)] == key && entry[len(key)] == '=' {
			return entry[len(key)+1:], true
		}
	}
	return "", false
}

// ResetPluginDatabases drops each local plugin's isolated schema
// (plugin_<slug>) so every run starts from clean plugin state. The
// drizzle_migrations journal lives inside the plugin schema, so one drop
// fully resets it. Generic for whatever plugins bos.config.json declares.
func ResetPluginDatabases() {
	workdir, err := findRepoRoot()
	if err != nil {
		log.Printf("WARN: skipping plugin database reset (repo root not found): %v", err)
		return
	}
	cmd := exec.Command("bun", "tests/regression/lib/reset-plugin-dbs.mjs")
	cmd.Dir = workdir
	out, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("WARN: plugin database reset failed: %v\n%s", err, tail(string(out), 2000))
		return
	}
	log.Printf("Plugin databases reset: %s", tail(string(out), 500))
}

// killStalePorts frees every port the target stack can bind. The list comes
// from the repo-derived config (base service ports plus one or two plugin
// ports per local plugin), so it tracks whatever bos.config.json declares.
func killStalePorts(cfg *Config) {
	ports := cfg.StalePorts
	if len(ports) == 0 {
		base, err := portOf(cfg.BaseURL)
		if err != nil {
			log.Printf("WARN: skipping stale-port cleanup (unparseable base URL %q): %v", cfg.BaseURL, err)
			return
		}
		ports = []int{base, base + 1, base + 2, base + 3, base + 4, base + 10, base + 11}
	}
	for _, port := range ports {
		exec.Command("sh", "-c", "lsof -ti:"+strconv.Itoa(port)+" | xargs kill -9 2>/dev/null || true").Run()
	}
	time.Sleep(500 * time.Millisecond)
}

func portOf(baseURL string) (int, error) {
	var port int
	if _, err := fmt.Sscanf(baseURL, "http://localhost:%d", &port); err == nil {
		return port, nil
	}
	if _, err := fmt.Sscanf(baseURL, "http://127.0.0.1:%d", &port); err == nil {
		return port, nil
	}
	return 0, fmt.Errorf("no port in %q", baseURL)
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
