package framework

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

const (
	readyTimeout    = 3 * time.Minute
	exitTimeout     = 30 * time.Second
	deadRetryWindow = 10 * time.Second
)

type Stack struct {
	t            *testing.T
	cmd          *exec.Cmd
	repoRoot     string
	registryPath string
	basePort     int

	Ports     map[string]int
	ChildPids []int

	exited   chan struct{}
	exitCode int
}

func findRepoRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("getting cwd: %v", err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "bos.config.json")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatalf("repo root (bos.config.json) not found from %s", dir)
		}
		dir = parent
	}
}

func requireTestDatabases(t *testing.T) {
	t.Helper()
	for _, port := range []int{5434, 5435} {
		conn, err := net.DialTimeout("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)), time.Second)
		if err != nil {
			t.Skipf("test database on port %d is not running — start it with `bun run test:db:up`", port)
		}
		conn.Close()
	}
}

// buildDevCommand assembles a real `bos dev` CLI invocation from source (bun
// cli.ts) on an explicit port block, with the test env layered on top:
// .env.test's DB URLs and secret, port-derived origins, and the ephemeral-run
// guards. interactive=false passes --no-interactive (signal-driven teardown
// tests); interactive=true leaves the TUI to mount under the caller's pty.
func buildDevCommand(t *testing.T, basePort int, registryPath string, interactive bool) (*exec.Cmd, *os.File, string) {
	t.Helper()
	repoRoot := findRepoRoot(t)

	dotenv, err := parseDotenvFile(filepath.Join(repoRoot, ".env.test"))
	if err != nil {
		t.Fatalf("parsing .env.test: %v", err)
	}
	overrides := envOverridesFromDotenv(dotenv)
	origin := "http://localhost:" + strconv.Itoa(basePort)
	overrides["BASE_URL"] = origin
	overrides["CORS_ORIGIN"] = origin
	overrides["BOS_NO_PERSIST_PORTS"] = "1"
	overrides["BO_PID_REGISTRY_PATH"] = registryPath
	if interactive {
		overrides["TERM"] = "xterm-256color"
	}

	args := []string{
		filepath.Join(repoRoot, "packages", "everything-dev", "src", "cli.ts"),
		"dev",
	}
	if !interactive {
		args = append(args, "--no-interactive")
	}
	args = append(args,
		"--port", strconv.Itoa(basePort),
		"--api-port", strconv.Itoa(basePort+1),
		"--auth-port", strconv.Itoa(basePort+2),
		"--ui-port", strconv.Itoa(basePort+3),
		"--plugin-port-start", strconv.Itoa(basePort+10),
	)

	cmd := exec.Command("bun", args...)
	cmd.Dir = repoRoot
	cmd.Env = childEnv(overrides)

	logPath := filepath.Join(repoRoot, ".bos", "logs", fmt.Sprintf("framework-%d.log", basePort))
	if mkErr := os.MkdirAll(filepath.Dir(logPath), 0o755); mkErr != nil {
		t.Fatalf("creating log dir: %v", mkErr)
	}
	logFile, logErr := os.Create(logPath)
	if logErr != nil {
		t.Fatalf("creating log file: %v", logErr)
	}
	return cmd, logFile, repoRoot
}

// StartStack boots a real `bos dev` session from source (bun cli.ts) on an
// explicit port block, waits for the host to answer /health, then waits for
// the registry to carry the session's full childPids map. registryPath is
// caller-owned: tests that boot multiple stacks pass the SAME path (like the
// real shared registry) so adoption scenarios can observe a predecessor's
// dead entries.
func StartStack(t *testing.T, basePort int, registryPath string) *Stack {
	t.Helper()

	cmd, logFile, repoRoot := buildDevCommand(t, basePort, registryPath, false)
	cmd.Stdout = logFile
	cmd.Stderr = logFile

	stack := &Stack{
		t:            t,
		cmd:          cmd,
		repoRoot:     repoRoot,
		registryPath: registryPath,
		basePort:     basePort,
		exited:       make(chan struct{}, 1),
	}
	if startErr := cmd.Start(); startErr != nil {
		t.Fatalf("starting bos dev (port block %d): %v", basePort, startErr)
	}
	t.Cleanup(func() {
		logFile.Close()
	})
	t.Cleanup(stack.reap)
	go func() {
		waitErr := cmd.Wait()
		stack.exitCode = exitCodeOf(cmd, waitErr)
		close(stack.exited)
	}()

	waitForReady(t, stack)
	stack.awaitRegistryEntry()
	return stack
}

func waitForReady(t *testing.T, stack *Stack) {
	t.Helper()
	url := fmt.Sprintf("http://127.0.0.1:%d/health", stack.basePort)
	client := &http.Client{Timeout: 2 * time.Second}
	deadline := time.Now().Add(readyTimeout)
	for {
		resp, err := client.Get(url)
		if err == nil {
			resp.Body.Close()
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("host on port %d never became ready within %v (last: %v)\n--- log tail ---\n%s",
				stack.basePort, readyTimeout, err, stack.logTail(30))
		}
		time.Sleep(500 * time.Millisecond)
	}
}

// awaitRegistryEntry waits until the CLI has registered itself with a full
// childPids map (written after the last service reaches ready).
func (s *Stack) awaitRegistryEntry() {
	s.t.Helper()
	deadline := time.Now().Add(60 * time.Second)
	for {
		entry, err := s.ownEntry()
		if err == nil && len(entry.ChildPids) > 0 {
			s.Ports = entry.Ports
			s.ChildPids = entry.ChildPids
			return
		}
		if time.Now().After(deadline) {
			s.t.Fatalf("registry entry with childPids never appeared for pid %d (registry %s): %v",
				s.cmd.Process.Pid, s.registryPath, err)
		}
		time.Sleep(250 * time.Millisecond)
	}
}

func (s *Stack) ownEntry() (*registryEntry, error) {
	entries, err := readRegistry(s.registryPath)
	if err != nil {
		return nil, err
	}
	for i := range entries {
		if entries[i].PID == s.cmd.Process.Pid {
			return &entries[i], nil
		}
	}
	return nil, fmt.Errorf("no registry entry for pid %d", s.cmd.Process.Pid)
}

// SnapshotPids returns every pid that must be dead after teardown: the
// registry's direct children plus all their process-group members
// (rspack/rsbuild watcher grandchildren included).
func (s *Stack) SnapshotPids() []int {
	s.t.Helper()
	members, err := groupMembers(s.ChildPids)
	if err != nil {
		s.t.Fatalf("snapshotting process groups: %v", err)
	}
	return members
}

func (s *Stack) Signal(sig syscall.Signal) {
	s.t.Helper()
	if err := s.cmd.Process.Signal(sig); err != nil {
		s.t.Fatalf("signaling bos dev: %v", err)
	}
}

// WaitExit fails the test if the CLI does not exit with the expected code in
// time, including the log tail for diagnosis.
func (s *Stack) WaitExit(expectedCode int) {
	s.t.Helper()
	select {
	case <-s.exited:
		if s.exitCode != expectedCode {
			s.t.Fatalf("bos dev exited %d, want %d\n--- log tail ---\n%s",
				s.exitCode, expectedCode, s.logTail(30))
		}
	case <-time.After(exitTimeout):
		s.t.Fatalf("bos dev did not exit within %v\n--- log tail ---\n%s",
			exitTimeout, s.logTail(30))
	}
}

// Reap is the test's own safety net: hard-kill the CLI and every child group
// so a failed assertion never leaks processes into the next run.
func (s *Stack) Reap() {
	pids := append([]int{s.cmd.Process.Pid}, s.ChildPids...)
	for _, pid := range pids {
		_ = syscall.Kill(-pid, syscall.SIGKILL)
		_ = syscall.Kill(pid, syscall.SIGKILL)
	}
}

func (s *Stack) reap() {
	s.Reap()
}

func (s *Stack) logTail(n int) string {
	raw, err := os.ReadFile(fmt.Sprintf("%s/.bos/logs/framework-%d.log", s.repoRoot, s.basePort))
	if err != nil {
		return fmt.Sprintf("(no log: %v)", err)
	}
	lines := strings.Split(strings.TrimSpace(string(raw)), "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, "\n")
}

// RunBosKill invokes `bos kill` in the repo root, sharing the stack's
// registry override so it acts on the test session's entry.
func (s *Stack) RunBosKill() {
	s.t.Helper()
	cliPath := filepath.Join(s.repoRoot, "packages", "everything-dev", "src", "cli.ts")
	cmd := exec.Command("bun", cliPath, "kill")
	cmd.Dir = s.repoRoot
	base := os.Environ()
	filtered := base[:0:0]
	for _, entry := range base {
		if strings.HasPrefix(entry, "BO_PID_REGISTRY_PATH=") {
			continue
		}
		filtered = append(filtered, entry)
	}
	cmd.Env = append(filtered, "BO_PID_REGISTRY_PATH="+s.registryPath)
	out, err := cmd.CombinedOutput()
	if err != nil {
		s.t.Fatalf("bos kill failed: %v\n%s", err, tailString(string(out), 20))
	}
	s.t.Logf("bos kill output: %s", tailString(string(out), 20))
}

func exitCodeOf(cmd *exec.Cmd, err error) int {
	if err == nil {
		return 0
	}
	if exitErr, ok := err.(*exec.ExitError); ok {
		if status, ok := exitErr.Sys().(syscall.WaitStatus); ok {
			if status.Signaled() {
				return 128 + int(status.Signal())
			}
			return status.ExitStatus()
		}
		return exitErr.ExitCode()
	}
	return -1
}

func tailString(s string, n int) string {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, "\n")
}

// ---- registry ----

type registryEntry struct {
	PID       int            `json:"pid"`
	ConfigDir string         `json:"configDir"`
	Ports     map[string]int `json:"ports"`
	ChildPids []int          `json:"childPids"`
}

func readRegistry(path string) ([]registryEntry, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var entries []registryEntry
	if err := json.Unmarshal(raw, &entries); err != nil {
		return nil, err
	}
	return entries, nil
}
