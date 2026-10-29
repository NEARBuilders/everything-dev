---
"everything-dev": patch
---

Hotfix for the rc.26 slot-stamping incident: the deploy train now stamps only `app.*` slots (the base-runtime slots children never author — auth, host) from the release manifest's slots map. Plugin slots were being stamped into the child's leaf payload, which both expanded a declared-plugin child's composed plugin set to the whole parent set (violating the extends contract — a child's declared `plugins` object owns the entire plugin domain via a wholesale replace) and produced schema-invalid `plugins.<id>.ui` records (stamped ui entries carry no required `name`, and the wholesale replace never fills it) — blocking every child with authored plugins from deploying. Children pinned to rc.26 with authored `plugins` are CI-blocked until they run `bos upgrade`; live apps are unaffected (the boot-check refused the publish before any registry write).
