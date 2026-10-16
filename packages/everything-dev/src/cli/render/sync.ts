import { colors } from "../../utils/theme";

/** Bootstrap stubs that retire as conflicted on sync (ADR 0023). */
const RETIRED_BOOTSTRAP_STUBS = [
  "ui/src/entry.ts",
  "ui/src/hydrate.tsx",
  "ui/src/router.server.tsx",
  "ui/src/compose.ts",
];

/** Post-sync guidance when hand-modified bootstrap stubs were retired. */
export function printStubMigrationGuide(retiredConflicted: string[] | undefined) {
  const handModified = (retiredConflicted ?? []).filter((f) => RETIRED_BOOTSTRAP_STUBS.includes(f));
  if (handModified.length === 0) return;
  console.log(`  ${colors.yellow("Port your stub customizations into the authored seams:")}`);
  console.log(
    `    ${colors.dim("- defaultErrorComponent / defaultPendingComponent / defaultNotFoundComponent")}`,
  );
  console.log(
    `    ${colors.dim("  → set them inside the createRouter factory in ui/src/router.tsx (after ...opts)")}`,
  );
  console.log(
    `    ${colors.dim("- apiConnectionError copy + SSR locale config (locales, defaultLocale, cookieName)")}`,
  );
  console.log(
    `    ${colors.dim("  → export apiConnectionError / appLocale from ui/src/app.ts (see the scaffold template)")}`,
  );
  console.log(`    ${colors.dim("  backed-up originals: .bos/sync-backup/<timestamp>/")}`);
}
