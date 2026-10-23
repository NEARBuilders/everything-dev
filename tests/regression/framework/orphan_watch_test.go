package framework

import (
	"path/filepath"
	"testing"
)

// TestOrphanedSessionForceExits: killing the wrapper above a running
// `bos dev` session (playwright tree-kill, a dead pnpm chain) reparents the
// CLI; the orphan watchdog must force-exit the session and its whole service
// tree on its own — no external signal, no zombie, no port squatters, no
// 200ms crash loop (#507).
func TestOrphanedSessionForceExits(t *testing.T) {
	t.Parallel()
	acquireStackSlot(t)
	defer releaseStackSlot()

	stack := StartWrappedStack(t, blockOrphanedSession, filepath.Join(t.TempDir(), "pids.json"))
	pids := stack.SnapshotPids()
	if len(pids) < 2 {
		t.Fatalf("expected at least 2 processes in the kill snapshot (children + watchers), got %d", len(pids))
	}

	stack.KillWrapper()
	stack.WaitChildExit(orphanExitDeadline)

	AssertTeardownComplete(t, append(pids, stack.wrappedPid), portList(stack), deadRetryWindow)
	AssertRegistryClean(t, stack.registryPath, stack.wrappedPid)
	AssertNoRepoSurvivors(t, stack.repoRoot, stack.basePort, stack.registryPath)
}
