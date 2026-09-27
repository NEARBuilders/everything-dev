---
"everything-dev": minor
---

Type `rpcBase` as a root-prefixed path at the runtime-config schema source (`z.templateLiteral`), drop the unchecked `/${string}` casts in the client factories, and pass DAO transaction args to near-kit without the `Record<string, never>` cast.
