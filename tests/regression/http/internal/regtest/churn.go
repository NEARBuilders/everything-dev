package regtest

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

// DevShapeRebuildUi rebuilds the ui workspace exactly the way the dev stack
// does at boot: `every-plugin build` stamped with the dev server's env
// (BOS_DEV_SERVER=1) and the SSR container flag (BOS_SSR=1). Without those
// stamps the build emits hashed build-train artifacts and WIPES
// dist/ssr/remoteEntry.server.js — a running dev stack then loses its SSR
// container (the poll URL 404s until the dev-shape build runs again).
//
// This is the churn primitive for module-swap tests: the rebuild rewrites
// dist bytes in place (new hashed chunk names, new container mtime) while the
// stack keeps running.
func DevShapeRebuildUi(t *testing.T) {
	t.Helper()
	cmd := exec.Command("node", "--import", "tsx", "--conditions=development",
		filepath.Join(RepoRoot(), "packages", "every-plugin", "src", "cli.ts"), "build")
	// every-plugin resolves from the ui workspace so its build targets ui.
	cmd.Dir = filepath.Join(RepoRoot(), "ui")
	cmd.Env = append(os.Environ(),
		"BOS_DEV_SERVER=1",
		"BOS_SSR=1",
	)
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	if err := cmd.Run(); err != nil {
		t.Fatalf("dev-shape ui rebuild failed: %v\n%s", err, tailString(out.String(), 4000))
	}

	// A content-only churn of a lazy route chunk leaves the container
	// bootstrap (remoteEntry.server.js) byte-identical, and rsbuild then
	// skips rewriting it — its mtime, and with it the host's container
	// version (?v=<mtime>), never advances. A real container-changing
	// rebuild rewrites the artifact, so restamp the mtime to represent one.
	serverEntry := filepath.Join("dist", "ssr", "remoteEntry.server.js")
	now := time.Now()
	if err := os.Chtimes(filepath.Join(cmd.Dir, serverEntry), now, now); err != nil {
		t.Fatalf("restamping ui SSR container mtime: %v", err)
	}
}

// EditUiSourceWithMarker appends a unique marker to the /about description
// fallback in ui/src/routes/_public/about.tsx (a string that renders into the
// SSR HTML when the runtime config has no description) and registers a
// t.Cleanup that restores the original file. Returns the marker to look for.
func EditUiSourceWithMarker(t *testing.T) string {
	t.Helper()
	aboutPath := filepath.Join(RepoRoot(), "ui", "src", "routes", "_public", "about.tsx")
	original, err := os.ReadFile(aboutPath)
	if err != nil {
		t.Fatalf("reading about.tsx: %v", err)
	}
	t.Cleanup(func() {
		if err := os.WriteFile(aboutPath, original, 0o644); err != nil {
			t.Logf("WARN: failed to restore %s: %v", aboutPath, err)
		}
	})

	marker := fmt.Sprintf("CHURN-%d", time.Now().UnixMilli())
	needle := "how it's built, and how to build on it."
	replacement := needle + " " + marker
	content := strings.Replace(string(original), needle, replacement, 1)
	if content == string(original) {
		t.Fatalf("churn needle %q not found in about.tsx — fixture drift", needle)
	}
	if err := os.WriteFile(aboutPath, []byte(content), 0o644); err != nil {
		t.Fatalf("editing about.tsx: %v", err)
	}
	return marker
}

// RegressionLogsWithMarks returns the plausible host log files for the
// running regression stack (start-stack names by mode, dashes for colons).
func RegressionLogsWithMarks(t *testing.T) []string {
	t.Helper()
	paths := []string{
		filepath.Join(RepoRoot(), ".bos", "logs", "regression-"+strings.ReplaceAll(modeForFs(), ":", "-")+".log"),
		filepath.Join(RepoRoot(), ".bos", "logs", "regression-dev.log"),
	}
	var found []string
	for _, p := range paths {
		if _, err := os.Stat(p); err == nil {
			found = append(found, p)
		}
	}
	return found
}

var containerVersionPattern = regexp.MustCompile(`ssr/remoteEntry\.server\.js\?v=([0-9.]+)`)

// LogOffsets snapshots the current byte size of each log — the regression
// logs are cumulative across runs, so churn tests scan only bytes appended
// after the snapshot.
func LogOffsets(t *testing.T, logs []string) map[string]int64 {
	t.Helper()
	offsets := map[string]int64{}
	for _, logPath := range logs {
		info, err := os.Stat(logPath)
		if err != nil {
			continue
		}
		offsets[logPath] = info.Size()
	}
	return offsets
}

// ContainerVersionsSince scans each log from its snapshotted offset for
// "ssr/remoteEntry.server.js?v=<mtime>" occurrences (the host's
// local-container marks) and returns the versions seen after the snapshot.
func ContainerVersionsSince(t *testing.T, logs []string, offsets map[string]int64) map[string]bool {
	t.Helper()
	versions := map[string]bool{}
	for _, logPath := range logs {
		offset, ok := offsets[logPath]
		if !ok {
			continue
		}
		data, err := os.ReadFile(logPath)
		if err != nil || int64(len(data)) <= offset {
			continue
		}
		for _, match := range containerVersionPattern.FindAllStringSubmatch(string(data[offset:]), -1) {
			versions[match[1]] = true
		}
	}
	return versions
}

func modeForFs() string {
	if mode := os.Getenv("REGRESSION_MODE"); mode != "" {
		return mode
	}
	return string(Mode())
}

func tailString(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[len(s)-max:]
}
