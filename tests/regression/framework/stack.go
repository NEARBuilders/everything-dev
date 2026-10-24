package framework

import (
	"encoding/json"
	"fmt"
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
	exitTimeout = 30 * time.Second
	// deadRetryWindow bounds the teardown polls; AssertTeardownComplete runs
	// them concurrently so the wall cost is one window, not two.
	deadRetryWindow = 10 * time.Second
)

// readyTimeout bounds how long one boot may take to reach readiness.
// Env-tunable so CI can add headroom under slot contention (three parallel
// boots on a 4-core runner stretch each boot); the 3-minute default keeps
// local false-reds fast.
var readyTimeout = func() time.Duration {
	if raw, err := strconv.Atoi(os.Getenv("BOS_FRAMEWORK_READY_TIMEOUT_MINUTES")); err == nil && raw > 0 {
		return time.Duration(raw) * time.Minute
	}
	return 3 * time.Minute
}()

// maxStackSlots bounds how many dev stacks boot concurrently across the
// parallel tests (each stack is a full tsx CLI + services + watchers; more
// slots than cores thrashes boots past readyTimeout). Env-tunable so CI
// runners with fewer cores can pin a smaller bound.
var maxStackSlots = func() int {
	if raw, err := strconv.Atoi(os.Getenv("BOS_FRAMEWORK_STACK_SLOTS")); err == nil && raw > 0 {
		return raw
	}
	return 3
}()

var stackSlots = make(chan struct{}, maxStackSlots)

// acquireStackSlot blocks until a stack slot frees. Every test holds exactly
// one slot for its whole body (adoption tests boot two stacks sequentially
// under one slot), released via defer before t.Cleanup reaping.
func acquireStackSlot(t *testing.T) {
	t.Helper()
	select {
	case stackSlots <- struct{}{}:
	case <-time.After(10 * time.Minute):
		t.Fatalf("timed out waiting for a stack slot")
	}
}

func releaseStackSlot() {
	<-stackSlots
}

type Stack struct {
	t            *testing.T
	cmd          *exec.Cmd
	repoRoot     string
	registryPath string
	basePort     int
	wrappedPid   int

	Ports     map[string]int
	ChildPids []int

	exited   chan struct{}
	exitCode int
}

// bosPid is the pid of the `bos dev` CLI itself — the direct child for
// StartStack stacks, the grandchild behind the wrapper for wrapped stacks.
func (s *Stack) bosPid() int {
	if s.wrappedPid != 0 {
		return s.wrappedPid
	}
	return s.cmd.Process.Pid
}

func findRepoRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("getting cwd: %v", err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "bos.app.ts")); err == nil {
			return dir
		}
		if _, err := os.Stat(filepath.Join(dir, "bos.config.json")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatalf("repo root (bos.app.ts) not found from %s", dir)
		}
		dir = parent
	}
}

// devInvocation assembles the real `bos dev` invocation shared by the direct
// and wrapped launch paths: the tsx cli.ts argv, the layered env
// (.env.test's secret — DB URLs are deliberately NOT passed: each stack runs
// on its own ephemeral pglite per the zero-config default), the port-derived
// origins, the ephemeral-run guards, the repo root, and the run's log file.
func devInvocation(t *testing.T, basePort int, registryPath string, interactive bool) ([]string, []string, string, *os.File) {
	t.Helper()
	repoRoot := findRepoRoot(t)

	dotenv, err := parseDotenvFile(filepath.Join(repoRoot, ".env.test"))
	if err != nil {
		t.Fatalf("parsing .env.test: %v", err)
	}
	devDotenv, _ := parseDotenvFile(filepath.Join(repoRoot, ".env"))
	overrides := envOverridesFromDotenv(dotenv, devDotenv)
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

	logPath := filepath.Join(repoRoot, ".bos", "logs", fmt.Sprintf("framework-%d.log", basePort))
	if mkErr := os.MkdirAll(filepath.Dir(logPath), 0o755); mkErr != nil {
		t.Fatalf("creating log dir: %v", mkErr)
	}
	logFile, logErr := os.Create(logPath)
	if logErr != nil {
		t.Fatalf("creating log file: %v", logErr)
	}
	return args, childEnv(overrides), repoRoot, logFile
}

// tsxArgs is the shared node/tsx invocation prefix used by every launch path
// (direct and wrapped).
func tsxArgs(args []string) []string {
	return append([]string{"--import", "tsx", "--conditions=development"}, args...)
}

// buildDevCommand assembles a real `bos dev` CLI invocation from source
// (node --import tsx cli.ts — the parent's own dev-script form) on an explicit
// port block, with the test env layered on top. interactive=false passes
// --no-interactive (signal-driven teardown tests); interactive=true leaves
// the TUI to mount under the caller's pty.
//
// Setpgid puts every spawned stack in its own process group: a stray
// group-targeted kill (`kill(-pgid)`) can then never cross between the test
// tree and a stack (or two stacks). The pty launcher passes its own attrs
// (Setpgid without setsid/setctty — the TUI only needs stdin/stdout on a
// tty; hardened runners deny the setsid fork with EPERM, which the launcher
// turns into a skip).
func buildDevCommand(t *testing.T, basePort int, registryPath string, interactive bool) (*exec.Cmd, *os.File, string) {
	t.Helper()
	args, env, repoRoot, logFile := devInvocation(t, basePort, registryPath, interactive)

	cmd := exec.Command("node", tsxArgs(args)...)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Dir = repoRoot
	cmd.Env = env
	return cmd, logFile, repoRoot
}

// StartStack boots a real `bos dev` session from source (tsx cli.ts) on an
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
	t.Logf("stack %d: node started (pid %d)", basePort, cmd.Process.Pid)
	t.Cleanup(func() {
		logFile.Close()
	})
	t.Cleanup(stack.reap)
	go func() {
		waitErr := cmd.Wait()
		stack.exitCode = exitCodeOf(cmd, waitErr)
		close(stack.exited)
	}()

	stack.awaitRegistryEntry()
	return stack
}

// awaitRegistryEntry is the suite's single readiness definition: the CLI has
// registered itself with a full childPids map, which the session writes only
// after every service — host last — has reached ready. Unlike a /health probe
// on the base port (the deleted waitForReady), nothing else can satisfy it: a
// lingering orphan on an overlapping block's port answered /health in 1.6ms
// and faked a whole boot's readiness (run 40032463029).
func (s *Stack) awaitRegistryEntry() {
	s.t.Helper()
	deadline := time.Now().Add(readyTimeout)
	for {
		entry, err := s.ownEntry()
		if err == nil && len(entry.ChildPids) > 0 {
			s.Ports = entry.Ports
			s.ChildPids = entry.ChildPids
			s.t.Logf("stack %d: registry entry (%d children)", s.basePort, len(entry.ChildPids))
			return
		}
		if time.Now().After(deadline) {
			s.t.Fatalf("registry entry with childPids never appeared for pid %d (registry %s) within %v: %v\n--- log tail ---\n%s",
				s.bosPid(), s.registryPath, readyTimeout, err, s.logTail(30))
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
		if entries[i].PID == s.bosPid() {
			return &entries[i], nil
		}
	}
	return nil, fmt.Errorf("no registry entry for pid %d", s.bosPid())
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
	s.t.Logf("stack %d: sending %v to pid %d", s.basePort, sig, s.cmd.Process.Pid)
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
		s.t.Logf("stack %d: exited %d", s.basePort, s.exitCode)
		if s.exitCode != expectedCode {
			s.t.Fatalf("bos dev exited %d, want %d\n--- log tail ---\n%s",
				s.exitCode, expectedCode, s.logTail(30))
		}
	case <-time.After(exitTimeout):
		s.t.Fatalf("bos dev did not exit within %v\n--- log tail ---\n%s",
			exitTimeout, s.logTail(30))
	}
}

// Reap is the test's own safety net: hard-kill the CLI (and, for wrapped
// stacks, the wrapper) plus every child group so a failed assertion never
// leaks processes into the next run.
func (s *Stack) Reap() {
	pids := []int{s.cmd.Process.Pid}
	if s.wrappedPid != 0 {
		pids = append(pids, s.wrappedPid)
	}
	pids = append(pids, s.ChildPids...)
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
func (s *Stack) RunBosKill(extraArgs ...string) {
	s.t.Helper()
	s.t.Logf("stack %d: bos kill %s starting", s.basePort, strings.Join(extraArgs, " "))
	cliPath := filepath.Join(s.repoRoot, "packages", "everything-dev", "src", "cli.ts")
	cmd := exec.Command("node", append([]string{"--import", "tsx", "--conditions=development", cliPath, "kill"}, extraArgs...)...)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
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
