package framework

import (
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"syscall"
	"testing"
	"time"
)

// orphanExitDeadline: the orphan watchdog polls every 200ms and force-exits
// on the first reparenting tick; the window covers a slow tree reaping.
const orphanExitDeadline = 30 * time.Second

// StartWrappedStack boots `bos dev` through a throwaway wrapper process —
// the CLI is a grandchild, exactly the shape a real wrapper/pnpm chain
// produces. Killing the wrapper (SIGKILL, no signal handlers run) reparents
// the CLI and arms the orphan watchdog.
func StartWrappedStack(t *testing.T, basePort int, registryPath string) *Stack {
	t.Helper()

	args, env, repoRoot, logFile := devInvocation(t, basePort, registryPath, false)
	wrapper := filepath.Join(repoRoot, "tests", "regression", "lib", "orphan-wrapper.mjs")
	pidFile := filepath.Join(t.TempDir(), "wrapped.pid")

	cmd := exec.Command("node", append([]string{wrapper, pidFile, "node"}, tsxArgs(args)...)...)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Dir = repoRoot
	cmd.Env = env
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
		t.Fatalf("starting wrapped bos dev (port block %d): %v", basePort, startErr)
	}
	t.Cleanup(func() {
		logFile.Close()
	})
	t.Cleanup(stack.reap)
	go func() {
		waitErr := cmd.Wait()
		stack.exitCode = exitCodeOf(cmd, waitErr)
		close(stack.exited)
	}()

	stack.wrappedPid = awaitWrappedPid(t, pidFile)
	t.Logf("stack %d: wrapped CLI pid %d", basePort, stack.wrappedPid)
	waitForReady(t, stack)
	stack.awaitRegistryEntry()
	return stack
}

func awaitWrappedPid(t *testing.T, pidFile string) int {
	t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for {
		raw, err := os.ReadFile(pidFile)
		if err == nil {
			pid, convErr := strconv.Atoi(string(raw))
			if convErr == nil && pid > 1 {
				return pid
			}
		}
		if time.Now().After(deadline) {
			t.Fatalf("wrapper never wrote the wrapped pid file %s", pidFile)
		}
		time.Sleep(100 * time.Millisecond)
	}
}

// KillWrapper SIGKILLs the wrapper process only — the wrapped `bos dev`
// session survives, reparented, exactly like a playwright tree-kill or a
// dead pnpm chain leaves it.
func (s *Stack) KillWrapper() {
	s.t.Helper()
	s.t.Logf("stack %d: SIGKILL wrapper pid %d", s.basePort, s.cmd.Process.Pid)
	if err := syscall.Kill(s.cmd.Process.Pid, syscall.SIGKILL); err != nil {
		s.t.Fatalf("killing wrapper: %v", err)
	}
	select {
	case <-s.exited:
	case <-time.After(exitTimeout):
		s.t.Fatalf("wrapper did not exit after SIGKILL")
	}
}

// WaitChildExit fails if the wrapped `bos dev` session is still alive after
// the window — an orphaned session must force-exit on its own.
func (s *Stack) WaitChildExit(window time.Duration) {
	s.t.Helper()
	deadline := time.Now().Add(window)
	for pidAlive(s.wrappedPid) {
		if time.Now().After(deadline) {
			s.t.Fatalf("orphaned bos dev (pid %d) still alive after %v\n--- log tail ---\n%s",
				s.wrappedPid, window, s.logTail(30))
		}
		time.Sleep(250 * time.Millisecond)
	}
}
