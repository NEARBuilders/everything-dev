import { Effect } from "effect";
import { Finding, type RouterSeam } from "../domain";
import { fileExists, readText } from "../fs";

const ROUTER_PATH = "ui/src/router.tsx";
const APP_PATH = "ui/src/app.ts";

const AUTHORED_SEAM_RE = /everything-dev\/ui\/router-client/;
const MONOLITHIC_RE = /createTanStackRouter\s*\(/;

export const detectRouterSeam = (source: string): RouterSeam => {
  if (AUTHORED_SEAM_RE.test(source)) return "authored-seam";
  if (MONOLITHIC_RE.test(source)) return "monolithic";
  return "unknown";
};

export const readRouterSeam = (projectDir: string): Effect.Effect<RouterSeam, Error> =>
  Effect.gen(function* () {
    const exists = yield* fileExists(projectDir, ROUTER_PATH);
    if (!exists) return "absent";
    return detectRouterSeam(yield* readText(projectDir, ROUTER_PATH));
  });

const hasExport = (source: string, name: string): boolean =>
  new RegExp(`export\\s+(?:const|function)\\s+${name}\\b`).test(source);

export const checkUiSeam = (projectDir: string): Effect.Effect<Finding[], Error> =>
  Effect.gen(function* () {
    const findings: Finding[] = [];

    const routerSeam = yield* readRouterSeam(projectDir);
    if (routerSeam === "absent") {
      findings.push(
        new Finding({
          check: "ui-seam",
          path: ROUTER_PATH,
          severity: "warn",
          message:
            "ui/src/router.tsx not found — the authored router seam (ADR 0023) is required by the generated hydrate/SSR stubs",
        }),
      );
    }
    if (routerSeam === "monolithic") {
      findings.push(
        new Finding({
          check: "ui-seam",
          path: ROUTER_PATH,
          severity: "warn",
          message:
            "pre-ADR-0023 monolithic router factory — drops the composed manifest tree (opts.routeTree); apply migrates it to the createCoreRouter authored seam",
        }),
      );
    }
    if (routerSeam === "unknown") {
      findings.push(
        new Finding({
          check: "ui-seam",
          path: ROUTER_PATH,
          severity: "warn",
          message:
            "ui/src/router.tsx is neither the authored seam nor the known monolithic factory — inspect manually; apply will not touch it",
        }),
      );
    }

    const appExists = yield* fileExists(projectDir, APP_PATH);
    if (!appExists) {
      findings.push(
        new Finding({
          check: "ui-seam",
          path: APP_PATH,
          severity: "warn",
          message:
            "ui/src/app.ts not found — the @/app public surface is required by the generated stubs",
        }),
      );
      return findings;
    }

    const appSource = yield* readText(projectDir, APP_PATH);
    const missing = ["appLocale", "apiConnectionError"].filter(
      (name) => !hasExport(appSource, name),
    );
    if (missing.length > 0) {
      findings.push(
        new Finding({
          check: "ui-seam",
          path: APP_PATH,
          severity: "warn",
          message: `app surface is missing bootstrap overrides the generated stubs read: ${missing.join(", ")}`,
        }),
      );
    }

    return findings;
  });
