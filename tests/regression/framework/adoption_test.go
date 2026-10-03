package framework

import (
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

// Acceptance tests for plan 036 Phase 1 (bos kill escalation + verified
// release) and Phase 1.4 (startup adoption of orphaned childPids). They are
// red-by-design until that lands — gated behind BOS_TEARDOWN_ADOPTION=1 so
// the default suite stays green.

func adoptionEnabled() bool {
	return os.Getenv("BOS_TEARDOWN_ADOPTION") == "1"
}

func TestHardKillThenBosKillReapsOrphans(t *testing.T) {
	if !adoptionEnabled() {
		t.Skip("plan 036 Phase 1 acceptance — run with BOS_TEARDOWN_ADOPTION=1")
	}
	requireTestDatabases(t)

	registry := filepath.Join(t.TempDir(), "pids.json")
	stack := StartStack(t, 5600, registry)
	pids := stack.SnapshotPids()

	stack.Signal(syscall.SIGKILL)
	stack.WaitExit(128 + int(syscall.SIGKILL))

	stack.RunBosKill()

	AssertAllDead(t, pids, deadRetryWindow)
	AssertPortsFree(t, portList(stack), deadRetryWindow)
	AssertRegistryClean(t, stack.registryPath, stack.cmd.Process.Pid)
}

func TestNextBootAdoptsOrphans(t *testing.T) {
	if !adoptionEnabled() {
		t.Skip("plan 036 Phase 1.4 acceptance — run with BOS_TEARDOWN_ADOPTION=1")
	}
	requireTestDatabases(t)

	registry := filepath.Join(t.TempDir(), "pids.json")
	stack := StartStack(t, 5600, registry)
	pids := stack.SnapshotPids()

	stack.Signal(syscall.SIGKILL)
	stack.WaitExit(128 + int(syscall.SIGKILL))

	next := StartStack(t, 5700, registry)
	defer next.Reap()

	AssertAllDead(t, pids, deadRetryWindow)
	next.Signal(syscall.SIGTERM)
	next.WaitExit(0)
}
