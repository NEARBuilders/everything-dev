// Package framework regression-tests the bos CLI's process-death contract:
// every path that stops a `bos dev` session — signals, bos kill, a dead
// parent chain, a reboot over a dead session's orphans — must leave zero
// processes and zero held ports behind. The harness (stack.go, verify.go)
// owns booting, snapshots, and teardown assertions; each test drives one
// real stop path.
//
// Coverage is dev-mode only: `bos start` (the deployment image) shares none
// of the dev session's signal handling and has no process-death tests here —
// a start-mode leg needs docker in the job and is future work.
package framework
