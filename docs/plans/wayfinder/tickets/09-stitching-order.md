## Question

When a web plugin composes into the host, which sequencing applies: route-level grafting first, or UI-extends-UI federation (child UI inheriting routes/components from parent UI via Module Federation)?

## Resolution

**RESOLVED — grafting first.**

> **Re-annotation (2026-09-26):** the grafting-first resolution is
> historically accurate but superseded — ADR 0008 replaced grafting with
> manifest composition; the inheritance-as-a-layer question this ticket
> deferred is now owned by the node-model wayfinder (citynode.app#233).

- Route-level grafting (host mounts plugin route trees into host mount points) is the validated composition order; `ui-extends-ui-federation.md` was superseded — route-level composition was rejected and inheritance is a layer on top of grafting, gated on a prototype.
- Supersession recorded in the `plans/README.md` extensions table and map issue [citynode.app#108](https://github.com/NEARBuilders/citynode.app/issues/108).
- Note (2026-09): the grafting *runtime* itself was later superseded by manifest composition — see [ADR 0007](../../../adr/0007-runtime-composition-ssr.md) and [ADR 0008](../../../adr/0008-manifest-composition.md); build plan 033/034 in `docs/plans/`.
