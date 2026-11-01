package framework

import "testing"

// The framework suite's port-block layout. Every dev stack the suite boots
// needs 17 contiguous ports: base..base+3 for host/api/auth/ui and
// base+10..base+16 for the plugin dev servers. Blocks handed to concurrent
// tests must therefore be spaced at least 17 apart; the suite uses 20 for
// readability. Two CI incidents came from overlapping blocks (5950's plugin
// range sat on 5960's host block; 5800's plugin range sat on 5810's) — the
// guard test below turns that class into a test failure instead.
const blockWidth = 17

// Named blocks, one per concurrent test; TestNextBootAdoptsOrphans owns two
// (its first stack, and its second boot).
const (
	blockSignalQuitTerm   = 5300
	blockBosKillScoped    = 5400
	blockInteractiveQuitQ = 5800
	blockInteractiveCtrlC = 5820
	blockOrphanedSession  = 5900
	blockHardKill         = 5930
	blockNextBootFirst    = 5950
	blockNextBootAdopt    = 5970
	blockSignalQuitInt    = 6000
	blockBosKillAll       = 6100
)

// frameworkBlocks lists every block the suite may boot on; the survivor scan
// (verify.go) classifies a process carrying one of these --port markers as a
// sibling stack rather than this test's survivor.
var frameworkBlocks = []int{
	blockSignalQuitTerm,
	blockBosKillScoped,
	blockInteractiveQuitQ,
	blockInteractiveCtrlC,
	blockOrphanedSession,
	blockHardKill,
	blockNextBootFirst,
	blockNextBootAdopt,
	blockSignalQuitInt,
	blockBosKillAll,
}

// TestPortBlocksDisjoint fails if any two blocks' port ranges overlap — the
// layout invariant parallel boots depend on.
func TestPortBlocksDisjoint(t *testing.T) {
	for i, a := range frameworkBlocks {
		for _, b := range frameworkBlocks[i+1:] {
			if a < b+blockWidth && b < a+blockWidth {
				t.Fatalf("blocks %d and %d overlap (width %d)", a, b, blockWidth)
			}
		}
	}
}
