// Package framework regression-tests the bos CLI's process-death contract:
// every path that stops a `bos dev` session — signals, bos kill, a dead
// parent chain, a reboot over a dead session's orphans — must leave zero
// processes and zero held ports behind. The harness (stack.go, verify.go)
// owns booting, snapshots, and teardown assertions; each test drives one
// real stop path.
//
// Two boot confinements: most tests run on the death-contract fixture
// (fixtureDir in stack.go — a minimal authored config whose five services
// are fake node servers; the full CLI/planning/codegen/registry/TUI path is
// real, the boots reach ready in seconds and fit in RAM many at once).
// Exactly one test — TestSignalQuitKillsEverything/sigterm — boots the full
// stack from the repo root: the safety net proving the real rspack/rsbuild
// watcher shape (the grandchildren the fake services stand in for) dies too.
// Unit-level session semantics live beside them in
// packages/everything-dev/tests/unit/dev-session-processes.test.ts.
//
// Coverage is dev-mode only: `bos start` (the deployment image) shares none
// of the dev session's signal handling and has no process-death tests here —
// a start-mode leg needs docker in the job and is future work.
package framework
