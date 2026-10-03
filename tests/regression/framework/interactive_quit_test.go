package framework

import (
	"path/filepath"
	"testing"
)

// TestInteractiveQuitByKey drives a fully interactive dev session — the TUI
// live under a real pty, raw mode on — and quits with the q key. This is the
// user's quit path: no signal involved, just stdin bytes reaching the
// renderer's key handler.
func TestInteractiveQuitByKey(t *testing.T) {
	requireTestDatabases(t)

	stack := StartInteractiveStack(t, 5800, filepath.Join(t.TempDir(), "pids.json"))
	stack.WaitTuiMounted()

	pids := stack.SnapshotPids()
	if len(pids) < 2 {
		t.Fatalf("expected at least 2 processes in the kill snapshot (children + watchers), got %d", len(pids))
	}

	stack.SendInput([]byte("q"))
	stack.WaitExit(0)

	AssertAllDead(t, pids, deadRetryWindow)
	AssertPortsFree(t, portList(stack.Stack), deadRetryWindow)
	AssertRegistryClean(t, stack.registryPath, stack.cmd.Process.Pid)
	AssertNoRepoSurvivors(t, stack.repoRoot)
}

// TestInteractiveQuitByCtrlC sends the raw Ctrl-C byte AFTER the TUI has
// enabled raw mode (ISIG off, so no SIGINT is generated anywhere): the byte
// must reach the renderer's key handler and quit the whole stack gracefully.
// A session that swallows this byte is unquittable from its own terminal —
// exactly the bug this suite guards against.
func TestInteractiveQuitByCtrlC(t *testing.T) {
	requireTestDatabases(t)

	stack := StartInteractiveStack(t, 5810, filepath.Join(t.TempDir(), "pids.json"))
	stack.WaitTuiMounted()

	pids := stack.SnapshotPids()
	if len(pids) < 2 {
		t.Fatalf("expected at least 2 processes in the kill snapshot (children + watchers), got %d", len(pids))
	}

	stack.SendInput([]byte{'\x03'})
	stack.WaitExit(0)

	AssertAllDead(t, pids, deadRetryWindow)
	AssertPortsFree(t, portList(stack.Stack), deadRetryWindow)
	AssertRegistryClean(t, stack.registryPath, stack.cmd.Process.Pid)
	AssertNoRepoSurvivors(t, stack.repoRoot)
}
