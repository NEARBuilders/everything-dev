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
// The invocation goes through the ui workspace's own build script the way
// the dev stack's prerequisite train does (`pnpm run build` in ui/ —
// workspace.ts) — the every-plugin bin resolves through pnpm's PATH, which
// is what puts the root-hoisted rsbuild on it. A bare `node
// bin/every-plugin.mjs build` once shipped here and silently built nothing
// twice: src/cli.ts has no argv handling (exits 0), and rsbuild resolves
// only from the root node_modules/.bin. The elapsed guard below keeps both
// failure modes loud.
func DevShapeRebuildUi(t *testing.T) {
	t.Helper()
	rebuildStartedAt := time.Now()
	serverEntry := filepath.Join("dist", "ssr", "remoteEntry.server.js")
	cmd := exec.Command("pnpm", "run", "build")
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
	// A silent no-op build (the old src/cli.ts invocation) exits 0 without
	// writing artifacts; a real rsbuild rewrites at least the changed chunks
	// (a content-only churn can leave the container bootstrap byte-identical
	// and skipped, so the container's own mtime is NOT the signal). The
	// newest mtime anywhere under dist must advance past build start.
	newest, err := newestModTimeUnder(filepath.Join(cmd.Dir, "dist"))
	if err != nil {
		t.Fatalf("dev-shape ui rebuild produced no dist to inspect: %v\n%s", err,
			tailString(out.String(), 4000))
	}
	if !newest.After(rebuildStartedAt) {
		t.Fatalf("dev-shape ui rebuild wrote nothing under dist — a silent no-op "+
			"(newest mtime %s predates build start)\n%s", newest, tailString(out.String(), 4000))
	}
	t.Logf("dev-shape ui rebuild took %s", time.Since(rebuildStartedAt).Round(time.Millisecond))

	// A content-only churn of a lazy route chunk leaves the container
	// bootstrap (remoteEntry.server.js) byte-identical, and rsbuild then
	// skips rewriting it — its mtime, and with it the host's container
	// version (?v=<mtime>), never advances. A real container-changing
	// rebuild rewrites the artifact, so restamp the mtime to represent one.
	now := time.Now()
	if err := os.Chtimes(filepath.Join(cmd.Dir, serverEntry), now, now); err != nil {
		t.Fatalf("restamping ui SSR container mtime: %v", err)
	}
}

// newestModTimeUnder walks root and returns the newest file mtime under it.
func newestModTimeUnder(root string) (time.Time, error) {
	var newest time.Time
	err := filepath.WalkDir(root, func(_ string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		if info.ModTime().After(newest) {
			newest = info.ModTime()
		}
		return nil
	})
	if newest.IsZero() && err == nil {
		err = os.ErrNotExist
	}
	return newest, err
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
