package framework

import (
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/creack/pty"
)

// tuiMountMarker is the alt-screen enter escape the dev renderer writes when
// it mounts. It proves the session took the interactive path; raw mode is
// enabled a few statements later, so quitters wait on it plus a short settle
// window before sending bytes — a premature Ctrl-C would arrive while ISIG is
// still on and SIGINT the session instead of exercising the key path.
const (
	tuiMountMarker = "\x1b[?1049h"
	tuiSettleDelay = time.Second
	tuiPtyRows     = 40
	tuiPtyCols     = 120
	outputKeepMax  = 1 << 20
)

// InteractiveStack is a Stack running under a real pseudo-terminal: stdin and
// stdout are TTYs, so the dev session mounts its TUI, enables raw mode, and
// quits through the key path (q / Ctrl-C) instead of signals.
type InteractiveStack struct {
	*Stack

	master *os.File

	mu      sync.Mutex
	output  string
	mounted chan struct{}
}

// StartInteractiveStack boots the same stack as StartStack but without
// --no-interactive and under a pty, so the TUI is live. Pty output is teed
// into the framework-<port>.log the other tests read their tails from.
func StartInteractiveStack(t *testing.T, basePort int, registryPath string) *InteractiveStack {
	t.Helper()

	cmd, logFile, repoRoot := buildDevCommand(t, basePort, registryPath, true)

	stack := &InteractiveStack{
		Stack: &Stack{
			t:            t,
			cmd:          cmd,
			repoRoot:     repoRoot,
			registryPath: registryPath,
			basePort:     basePort,
			exited:       make(chan struct{}, 1),
		},
		mounted: make(chan struct{}, 1),
	}

	master, startErr := pty.StartWithSize(cmd, &pty.Winsize{Rows: tuiPtyRows, Cols: tuiPtyCols})
	if startErr != nil {
		t.Fatalf("starting bos dev under pty (port block %d): %v", basePort, startErr)
	}
	stack.master = master
	t.Cleanup(func() {
		logFile.Close()
		master.Close()
	})
	t.Cleanup(stack.reap)
	go func() {
		waitErr := cmd.Wait()
		stack.exitCode = exitCodeOf(cmd, waitErr)
		close(stack.exited)
	}()

	go stack.teePtyOutput(logFile)

	waitForReady(t, stack.Stack)
	stack.awaitRegistryEntry()
	return stack
}

// teePtyOutput drains the pty master: everything the session prints is kept
// in a bounded tail buffer (for mount detection) and appended to the log file
// (for WaitExit/logTail diagnostics). The read returns EIO once the session
// and its tty are gone — that ends the goroutine, not the test.
func (s *InteractiveStack) teePtyOutput(logFile *os.File) {
	buf := make([]byte, 4096)
	for {
		n, err := s.master.Read(buf)
		if n > 0 {
			chunk := string(buf[:n])
			s.mu.Lock()
			s.output += chunk
			if len(s.output) > outputKeepMax {
				s.output = s.output[len(s.output)-outputKeepMax:]
			}
			mounted := strings.Contains(s.output, tuiMountMarker)
			s.mu.Unlock()
			if _, writeErr := logFile.WriteString(chunk); writeErr != nil {
				return
			}
			if mounted {
				select {
				case s.mounted <- struct{}{}:
				default:
				}
			}
		}
		if err != nil {
			return
		}
	}
}

// WaitTuiMounted blocks until the alt-screen escape appeared in the pty
// output, then lets the renderer finish enabling raw mode before callers
// send key bytes.
func (s *InteractiveStack) WaitTuiMounted() {
	s.t.Helper()
	select {
	case <-s.mounted:
	case <-time.After(30 * time.Second):
		s.t.Fatalf("TUI never mounted under the pty\n--- pty tail ---\n%s", s.OutputTail(30))
	}
	time.Sleep(tuiSettleDelay)
}

// SendInput writes bytes to the pty master — they reach the session's stdin
// as if typed into the terminal.
func (s *InteractiveStack) SendInput(b []byte) {
	s.t.Helper()
	if _, err := s.master.Write(b); err != nil {
		s.t.Fatalf("writing %q to pty: %v", b, err)
	}
}

// OutputTail returns the last n lines of pty output for failure messages.
func (s *InteractiveStack) OutputTail(n int) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	lines := strings.Split(strings.TrimSpace(s.output), "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, "\n")
}
