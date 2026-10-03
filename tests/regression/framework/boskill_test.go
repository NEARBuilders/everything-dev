package framework

import (
	"path/filepath"
	"testing"
)

// TestBosKillOnLiveSession: the external-kill path users actually hit when a
// session misbehaves — `bos kill` against a live session must take down the
// CLI, every service child, and every watcher, then clean the registry.
func TestBosKillOnLiveSession(t *testing.T) {
	requireTestDatabases(t)

	stack := StartStack(t, 5400, filepath.Join(t.TempDir(), "pids.json"))
	pids := stack.SnapshotPids()
	if len(pids) < 2 {
		t.Fatalf("expected at least 2 processes in the kill snapshot (children + watchers), got %d", len(pids))
	}

	stack.RunBosKill()

	AssertAllDead(t, pids, deadRetryWindow)
	AssertPortsFree(t, portList(stack), deadRetryWindow)
	AssertRegistryClean(t, stack.registryPath, stack.cmd.Process.Pid)
	AssertNoRepoSurvivors(t, stack.repoRoot)
}
