package framework

import (
	"fmt"
	"net"
	"os"
	"os/exec"
	"strconv"
	"strings"
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
	deadline := time.Now().Add(window)
	for {
		var alive []int
		for _, pid := range pids {
			if pidAlive(pid) {
				alive = append(alive, pid)
			}
		}
		if len(alive) == 0 {
			return
		}
		if time.Now().After(deadline) {
			survivors := describePids(alive)
			t.Fatalf("%d process(es) survived teardown: %s", len(alive), survivors)
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
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("ports still bound after teardown: %v", blocked)
		}
		time.Sleep(250 * time.Millisecond)
	}
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
func AssertNoRepoSurvivors(t *testing.T, repoRoot string) {
	t.Helper()
	lines, err := psCommandLines()
	if err != nil {
		t.Fatalf("listing processes: %v", err)
	}
	var survivors []string
	for _, line := range lines {
		if !strings.Contains(line, repoRoot) {
			continue
		}
		if strings.Contains(line, "go test") || strings.Contains(line, "regression/teardown") {
			continue
		}
		if strings.Contains(line, "rspack") || strings.Contains(line, "rsbuild") ||
			strings.Contains(line, "cli.ts dev") {
			survivors = append(survivors, strings.TrimSpace(line))
		}
	}
	if len(survivors) > 0 {
		t.Fatalf("%d repo dev process(es) survived teardown:\n%s", len(survivors), strings.Join(survivors, "\n"))
	}
}
