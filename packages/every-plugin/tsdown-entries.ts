export interface EntrySpec {
  entry: string;
  export: string | null;
  require?: boolean;
}

export const entries: EntrySpec[] = [
  { entry: "src/index.ts", export: "." },
  { entry: "src/client.ts", export: "./client", require: false },
  { entry: "src/identity.ts", export: "./identity" },
  { entry: "src/types.ts", export: "./types" },
  { entry: "src/errors.ts", export: "./errors" },
  { entry: "src/remote-entry.ts", export: "./remote-entry" },
  { entry: "src/runtime/index.ts", export: "./runtime" },
  { entry: "src/runtime/mf-config.ts", export: null },
  { entry: "src/runtime/services/normalize.ts", export: "./normalize" },
  { entry: "src/shared-deps-spec.ts", export: "./shared-deps-spec" },
  { entry: "src/build/rspack/index.ts", export: "./build/rspack" },
  { entry: "src/build/artifact-names.ts", export: "./build/artifact-names" },
  { entry: "src/version-manifest.ts", export: "./version-manifest" },
  { entry: "src/ui/manifest/index.ts", export: "./ui/manifest" },
  { entry: "src/ui/manifest/generator.ts", export: "./ui/manifest-generator" },
  { entry: "src/ui/manifest/contract.ts", export: "./ui/manifest/contract" },
  { entry: "src/build/ui/index.ts", export: "./build/ui" },
  { entry: "src/dev/host.ts", export: "./dev-host", require: false },
  { entry: "src/dev/serve.ts", export: "./dev-serve", require: false },
  { entry: "src/cli.ts", export: null },
];
