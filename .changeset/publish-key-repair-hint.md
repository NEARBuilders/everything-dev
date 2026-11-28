---
"everything-dev": patch
---

The publish preflight's add-key repair hint now prints a runnable `near-cli-rs` command. The old hint used flags no `near` CLI accepts (`--receiver-id`, `--method-names`, an unflagged `network-config`) and carried a stray quote; it now shares the argument vector `bos login --key` runs (`grant-function-call-access`), and targets the network the probe checked instead of always saying `mainnet`.

