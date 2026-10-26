package framework

import (
	"fmt"
	"net"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
)

// groupMembers reports the pids of every process whose process group is one
// of the given pids' groups. Detached bos children are group leaders
// (pgid == pid), so their process-group members are exactly the grandchildren
// that escape naive pid-based kill checks: rspack/rsbuild watchers, workers.
func groupMembers(pids []int) ([]int, error) {
	lines, err := psPidPgidLines()
	if err != nil {
		return nil, err
	}
	wanted := map[int]bool{}
	for _, pid := range pids {
		wanted[pid] = true
	}
	var members []int
	for _, line := range lines {
		fields := strings.Fields(line)
		if len(fields) != 2 {
			continue
		}
		pid, err1 := strconv.Atoi(fields[0])
		pgid, err2 := strconv.Atoi(fields[1])
		if err1 != nil || err2 != nil {
			continue
		}
		if wanted[pgid] || wanted[pid] {
			members = append(members, pid)
		}
	}
	return members, nil
}

func psPidPgidLines() ([]string, error) {
	for _, args := range [][]string{
		{"-axo", "pid=,pgid="},
		{"-eo", "pid=,pgid="},
	} {
		out, err := exec.Command("ps", args...).Output()
		if err == nil {
			return strings.Split(strings.TrimSpace(string(out)), "\n"), nil
		}
	}
	return nil, fmt.Errorf("ps pid/pgid listing failed on this platform")
}

func psCommandLines() ([]string, error) {
	for _, args := range [][]string{
		{"-axo", "pid=,command="},
		{"-eo", "pid=,command="},
	} {
		out, err := exec.Command("ps", args...).Output()
		if err == nil {
			return strings.Split(strings.TrimSpace(string(out)), "\n"), nil
		}
	}
	return nil, fmt.Errorf("ps pid/command listing failed on this platform")
}

func pidAlive(pid int) bool {
	err := syscall.Kill(pid, syscall.Signal(0))
	return err == nil || isPermission(err)
}

func isPermission(err error) bool {
	if err == nil {
		return false
	}
	errno, ok := err.(syscall.Errno)
	return ok && errno == syscall.EPERM
}

// AssertAllDead polls until every pid is gone (kill(pid,0) fails); on
// survivors it names them with their command lines.
func AssertAllDead(t *testing.T, pids []int, window time.Duration) {
	t.Helper()
	if survivors := waitAllDead(pids, window); len(survivors) > 0 {
		t.Fatalf("%d process(es) survived teardown: %s", len(survivors), describePids(survivors))
	}
}

func waitAllDead(pids []int, window time.Duration) []int {
	deadline := time.Now().Add(window)
	for {
		var alive []int
		for _, pid := range pids {
			if pidAlive(pid) {
				alive = append(alive, pid)
			}
		}
		if len(alive) == 0 {
			return nil
		}
		if time.Now().After(deadline) {
			return alive
		}
		time.Sleep(250 * time.Millisecond)
	}
}

func describePids(pids []int) string {
	lines, _ := psCommandLines()
	var parts []string
	for _, pid := range pids {
		description := fmt.Sprintf("pid %d", pid)
		for _, line := range lines {
			fields := strings.Fields(line)
			if len(fields) > 0 && fields[0] == strconv.Itoa(pid) {
				description += " (" + strings.TrimSpace(strings.TrimPrefix(line, fields[0])) + ")"
				break
			}
		}
		parts = append(parts, description)
	}
	return strings.Join(parts, "; ")
}

func portList(stack *Stack) []int {
	var ports []int
	for _, port := range stack.Ports {
		if port > 0 {
			ports = append(ports, port)
		}
	}
	return ports
}

// AssertPortsFree proves each port is bindable (a listener died) — not just
// that a known pid is gone.
func AssertPortsFree(t *testing.T, ports []int, window time.Duration) {
	t.Helper()
	if blocked := waitPortsFree(ports, window); len(blocked) > 0 {
		t.Fatalf("ports still bound after teardown: %v", blocked)
	}
}

func waitPortsFree(ports []int, window time.Duration) []int {
	deadline := time.Now().Add(window)
	for {
		var blocked []int
		for _, port := range ports {
			listener, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
			if err != nil {
				blocked = append(blocked, port)
				continue
			}
			listener.Close()
		}
		if len(blocked) == 0 {
			return nil
		}
		if time.Now().After(deadline) {
			return blocked
		}
		time.Sleep(250 * time.Millisecond)
	}
}

// AssertTeardownComplete runs the dead-pids and ports-free polls concurrently
// (independent observations of the same teardown) and fails with both
// findings if either window expires.
func AssertTeardownComplete(t *testing.T, pids []int, ports []int, window time.Duration) {
	t.Helper()
	var (
		wg      sync.WaitGroup
		alive   []int
		blocked []int
	)
	wg.Add(2)
	go func() {
		defer wg.Done()
		alive = waitAllDead(pids, window)
	}()
	go func() {
		defer wg.Done()
		blocked = waitPortsFree(ports, window)
	}()
	wg.Wait()
	if len(alive) == 0 && len(blocked) == 0 {
		return
	}
	message := "teardown incomplete:"
	if len(alive) > 0 {
		message += fmt.Sprintf("\n%d process(es) survived: %s", len(alive), describePids(alive))
	}
	if len(blocked) > 0 {
		message += fmt.Sprintf("\nports still bound: %v", blocked)
	}
	t.Fatal(message)
}

// AssertRegistryClean proves the CLI unregistered itself (no lingering entry
// for the session pid).
func AssertRegistryClean(t *testing.T, registryPath string, cliPid int) {
	t.Helper()
	entries, err := readRegistry(registryPath)
	if err != nil {
		if _, statErr := os.Stat(registryPath); statErr != nil {
			return
		}
		t.Fatalf("reading registry %s: %v", registryPath, err)
	}
	for _, entry := range entries {
		if entry.PID == cliPid {
			t.Fatalf("registry entry for pid %d still present after teardown (childPids %v)", cliPid, entry.ChildPids)
		}
	}
}

// AssertNoRepoSurvivors catches anything the pid snapshot could not name:
// any process whose command line references the repo root and looks like a
// dev-stack member (rspack/rsbuild watchers, cli dev sessions).
//
// Parallel-safe — sibling test stacks run their own stacks concurrently, so a
// candidate must be attributable to THIS test's stack before it can be a
// survivor, and dying-but-unattributable builders of sibling teardowns must
// not fail this test. Classification per candidate, in order of trust:
//  1. the candidate's BO_PID_REGISTRY_PATH environment (/proc, Linux) — a
//     different or absent registry path is a sibling or foreign stack;
//  2. the candidate's own `--port <block>` argv marker (stack CLIs carry
//     their base port) — this test's block is a survivor, a different known
//     block is a sibling master;
//  3. the candidate holds an open fd on THIS stack's framework log (every
//     process in a stack's tree inherits it — the macOS-portable attribution
//     channel, where ps cannot show environments);
//  4. unattributable: excluded while any sibling stack master is alive
//     (their teardown race is theirs); with none alive, the whole scan
//     re-runs for survivorGraceWindow — transient dying builders pass,
//     persistent ones are flagged as real leaks.
func AssertNoRepoSurvivors(t *testing.T, repoRoot string, ownBasePort int, ownRegistryPath string) {
	t.Helper()
	logPath := fmt.Sprintf("%s/.bos/logs/framework-%d.log", repoRoot, ownBasePort)
	deadline := time.Now().Add(survivorGraceWindow)
	for {
		lines, err := psCommandLines()
		if err != nil {
			t.Fatalf("listing processes: %v", err)
		}
		logHolderPids := openFileHolderPids(logPath)
		var (
			survivors      []string
			pending        []string
			siblingMasters int
		)
		for _, line := range lines {
			if !strings.Contains(line, repoRoot) {
				continue
			}
			if strings.Contains(line, "go test") || strings.Contains(line, "regression/teardown") {
				continue
			}
			if !strings.Contains(line, "rspack") && !strings.Contains(line, "rsbuild") &&
				!strings.Contains(line, "cli.ts dev") && !strings.Contains(line, "fake-service") {
				continue
			}
			fields := strings.Fields(line)
			if len(fields) == 0 {
				continue
			}
			pid, convErr := strconv.Atoi(fields[0])
			if convErr != nil {
				continue
			}
			if registryPath, ok := pidEnvValue(pid, "BO_PID_REGISTRY_PATH"); ok {
				if registryPath != ownRegistryPath {
					continue
				}
				survivors = append(survivors, strings.TrimSpace(line))
				continue
			}
			if port, ok := argvPort(line); ok {
				if port == ownBasePort {
					survivors = append(survivors, strings.TrimSpace(line))
				} else if knownFrameworkPorts[port] {
					siblingMasters++
				}
				continue
			}
			if logHolderPids[pid] {
				survivors = append(survivors, strings.TrimSpace(line))
				continue
			}
			pending = append(pending, strings.TrimSpace(line))
		}
		if siblingMasters == 0 {
			survivors = append(survivors, pending...)
		}
		if len(survivors) == 0 {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("%d repo dev process(es) survived teardown:\n%s", len(survivors), strings.Join(survivors, "\n"))
		}
		time.Sleep(time.Second)
	}
}

// survivorGraceWindow bounds the settle poll for unattributable candidates:
// a stack's watch builders can outlive their group-leader snapshot by a few
// seconds while dying; a real leak persists far longer than this.
const survivorGraceWindow = 15 * time.Second

// knownFrameworkPorts lists every port block the framework tests boot stacks
// on; a stack CLI's argv carries its block, so these markers identify sibling
// stacks in the survivor scan. Derived from the suite's block layout
// (ports.go).
var knownFrameworkPorts = func() map[int]bool {
	m := map[int]bool{}
	for _, block := range frameworkBlocks {
		m[block] = true
	}
	return m
}()

func argvPort(line string) (int, bool) {
	idx := strings.Index(line, "--port ")
	if idx == -1 {
		return 0, false
	}
	rest := strings.Fields(line[idx:])
	if len(rest) < 2 {
		return 0, false
	}
	port, err := strconv.Atoi(rest[1])
	if err != nil {
		return 0, false
	}
	return port, true
}

// pidEnvValue reads an environment variable from another process via /proc
// (Linux). ok is false when /proc is unavailable (macOS) or the key is not
// set.
func pidEnvValue(pid int, key string) (string, bool) {
	raw, err := os.ReadFile(fmt.Sprintf("/proc/%d/environ", pid))
	if err != nil {
		return "", false
	}
	for _, entry := range strings.Split(string(raw), "\x00") {
		if value, ok := strings.CutPrefix(entry, key+"="); ok {
			return value, true
		}
	}
	return "", false
}

// openFileHolderPids lists the pids holding an open fd on the given path
// (lsof). A stack's whole process tree inherits its framework log fd, so this
// attributes unattributable-looking watchers to the stack that owns the log.
// An absent lsof or a file with no openers yields an empty set.
func openFileHolderPids(path string) map[int]bool {
	out, err := exec.Command("lsof", "-t", path).Output()
	if err != nil {
		return nil
	}
	holders := map[int]bool{}
	for _, field := range strings.Fields(string(out)) {
		if pid, convErr := strconv.Atoi(field); convErr == nil {
			holders[pid] = true
		}
	}
	return holders
}
