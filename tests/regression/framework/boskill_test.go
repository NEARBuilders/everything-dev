package framework

import (
	"path/filepath"
	"testing"
)

// TestBosKillReapsLiveSession covers `bos kill` against a live session — the
// external-kill path users actually hit when a session misbehaves. Scoped
// (registry filtered by config dir) and `--all` (across all directories) take
// down the CLI, every service child, and every watcher, then clean the
// registry. Both run on the confined death-contract fixture.
func TestBosKillReapsLiveSession(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name  string
		args  []string
		block int
	}{
		{"scoped", nil, blockBosKillScoped},
		{"all", []string{"--all"}, blockBosKillAll},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			acquireStackSlot(t)
			defer releaseStackSlot()

			stack := StartStack(t, tc.block, filepath.Join(t.TempDir(), "pids.json"), fixtureDir(t))
			pids := stack.SnapshotPids()
			if len(pids) < 2 {
				t.Fatalf("expected at least 2 processes in the kill snapshot (children + watchers), got %d", len(pids))
			}

			stack.RunBosKill(tc.args...)

			AssertTeardownComplete(t, pids, portList(stack), deadRetryWindow)
			AssertRegistryClean(t, stack.registryPath, stack.cmd.Process.Pid)
			AssertNoRepoSurvivors(t, stack.repoRoot, tc.block, stack.registryPath)
		})
	}
}
