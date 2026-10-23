package framework

import (
	"path/filepath"
	"syscall"
	"testing"
)

// TestGracefulQuitKillsEverything: SIGTERM to a running `bos dev` session —
// the polite quit every user and harness triggers — must kill the CLI (exit
// 0), every service child, every rspack/rsbuild watcher grandchild, release
// every claimed port, and unregister the session.
func TestGracefulQuitKillsEverything(t *testing.T) {
	t.Parallel()
	acquireStackSlot(t)
	defer releaseStackSlot()

	stack := StartStack(t, 5300, filepath.Join(t.TempDir(), "pids.json"))
	pids := stack.SnapshotPids()
	if len(pids) < 2 {
		t.Fatalf("expected at least 2 processes in the kill snapshot (children + watchers), got %d", len(pids))
	}

	stack.Signal(syscall.SIGTERM)
	stack.WaitExit(0)

	AssertTeardownComplete(t, pids, portList(stack), deadRetryWindow)
	AssertRegistryClean(t, stack.registryPath, stack.cmd.Process.Pid)
	AssertNoRepoSurvivors(t, stack.repoRoot, stack.basePort, stack.registryPath)
}

// TestSigintQuitKillsEverything: plain SIGINT to a non-interactive session —
// the path `docker stop` and CI container teardown take — must behave exactly
// like SIGTERM: clean exit 0, full tree reaped, ports free, registry clean.
func TestSigintQuitKillsEverything(t *testing.T) {
	t.Parallel()
	acquireStackSlot(t)
	defer releaseStackSlot()

	stack := StartStack(t, 6000, filepath.Join(t.TempDir(), "pids.json"))
	pids := stack.SnapshotPids()
	if len(pids) < 2 {
		t.Fatalf("expected at least 2 processes in the kill snapshot (children + watchers), got %d", len(pids))
	}

	stack.Signal(syscall.SIGINT)
	stack.WaitExit(0)

	AssertTeardownComplete(t, pids, portList(stack), deadRetryWindow)
	AssertRegistryClean(t, stack.registryPath, stack.cmd.Process.Pid)
	AssertNoRepoSurvivors(t, stack.repoRoot, stack.basePort, stack.registryPath)
}
