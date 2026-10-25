import { Effect } from "effect";
import { Finding, type ImportRewrite } from "../domain";
import { listFiles, readText } from "../fs";

export const IMPORT_REWRITES: ReadonlyArray<readonly [string, string]> = [
  ['from "@/auth"', 'from "@/app"'],
  ["from '@/auth'", "from '@/app'"],
  ['from "@/lib/auth-utils"', 'from "@/lib/auth"'],
  ["from '@/lib/auth-utils'", "from '@/lib/auth'"],
  ['from "@/lib/use-api-client"', 'from "@/app"'],
  ["from '@/lib/use-api-client'", "from '@/app'"],
  ['from "@/lib/api-client"', 'from "@/app"'],
  ["from '@/lib/api-client'", "from '@/app'"],
  ['from "everything-dev/dist/', 'from "everything-dev/'],
  ["from 'everything-dev/dist/", "from 'everything-dev/"],
];

export const scanImports = (projectDir: string): Effect.Effect<readonly ImportRewrite[], Error> =>
  Effect.gen(function* () {
    const files = (yield* listFiles(projectDir, [
      "ui/src/**/*.{ts,tsx}",
      "api/src/**/*.ts",
      "plugins/*/src/**/*.{ts,tsx}",
    ])).filter((file) => !file.endsWith(".gen.ts") && !file.endsWith(".test.ts"));

    const sources = new Map<string, string>();
    for (const file of files) {
      sources.set(file, yield* readText(projectDir, file));
    }

    return IMPORT_REWRITES.map(([from, to]) => {
      const matched: string[] = [];
      for (const [file, source] of sources) {
        if (source.includes(from)) matched.push(file);
      }
      return { from, to, files: matched };
    });
  });

export const checkImports = (projectDir: string): Effect.Effect<Finding[], Error> =>
  Effect.gen(function* () {
    const rewrites = yield* scanImports(projectDir);
    return rewrites.flatMap((rewrite) =>
      rewrite.files.length === 0
        ? []
        : [
            new Finding({
              check: "imports",
              path: rewrite.files.join(", "),
              severity: "warn",
              message: `legacy import "${rewrite.from}" — rewrite to "${rewrite.to}"`,
            }),
          ],
    );
  });
