---
"everything-dev": patch
---

Generate `plugins-client.gen.ts` for local auth plugins during `bos types gen`. Previously the per-plugin client types were only written for entries in the `plugins` map, so a vendored local auth plugin importing generated `PluginsClient` types failed typecheck on fresh checkouts (the file existed only as a gitignored local leftover). The generated-files report now also resolves paths from each plugin's `localPath`, so `_template` is reported correctly and the auth plugin's generated file is listed.
