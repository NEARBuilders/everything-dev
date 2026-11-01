package framework

import (
	"path/filepath"
	"syscall"
	"testing"
)

// TestSignalQuitKillsEverything covers the polite quit paths every user and
// harness triggers — SIGTERM (docker stop, CI teardown) and SIGINT (Ctrl-C at
// a non-raw terminal; the CLI registers the same graceful handler for both).
// Each must kill the CLI (exit 0), every service child, every rspack/rsbuild
// watcher grandchild, release every claimed port, and unregister the session.
// sigint runs on the confined death-contract fixture (fast); sigterm is the
// suite's one full-stack boot — the safety net proving the real
// rspack/rsbuild watcher shape dies too.
func TestSignalQuitKillsEverything(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name      string
		sig       syscall.Signal
		block     int
		confineTo string
	}{
		{"sigterm", syscall.SIGTERM, blockSignalQuitTerm, ""},
		{"sigint", syscall.SIGINT, blockSignalQuitInt, fixtureDir(t)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			acquireStackSlot(t)
			defer releaseStackSlot()

			stack := StartStack(t, tc.block, filepath.Join(t.TempDir(), "pids.json"), tc.confineTo)
			pids := stack.SnapshotPids()
			if len(pids) < 2 {
				t.Fatalf("expected at least 2 processes in the kill snapshot (children + watchers), got %d", len(pids))
			}

			stack.Signal(tc.sig)
			stack.WaitExit(0)

			AssertTeardownComplete(t, pids, portList(stack), deadRetryWindow)
			AssertRegistryClean(t, stack.registryPath, stack.cmd.Process.Pid)
			AssertNoRepoSurvivors(t, stack.repoRoot, tc.block, stack.registryPath)
		})
	}
}
