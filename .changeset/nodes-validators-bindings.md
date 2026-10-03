---
"ui": minor
---

Replace the legacy city-node model with nodes + validators + domain bindings.

- Public landing directory and authenticated stake page now read from the new validator registry (`listValidators`, `resolveValidatorByAccountId`, `resolveStakingValidators`) instead of the legacy `listLegacyCityNodes` routes. Cards, query keys, and resolver state were renamed accordingly (`CityNodeCard` -> `ValidatorCard`, `selectedCityNode` -> `selectedValidator`).
- Admin "Tenant / Node / Binding" wizard now collects node hierarchy, validators-per-node, and verified custom-domain bindings in three guided steps before creating the tenant. Empty state and the "Not authorized" affordance now reference the tenant's stable id instead of a subdomain host.
- Removing the `NetworkToggle` from the auto-injected component barrel (the admin header still imports it directly) so the toggle is not eagerly bundled into every route.
