import { Effect, Exit } from "effect";
import { createPlugin } from "every-plugin";
import {
  type WorkspaceVersionManifest,
  WorkspaceVersionManifestSchema,
} from "every-plugin/version-manifest";
import { z } from "zod";
import { authorizeUploadRequest, readUploadAuthConfig } from "./auth";
import { contract } from "./contract";
import {
  buildBundleKey,
  bundleCacheControl,
  bundleContentType,
  computeObjectIntegrity,
  createStorageLayerFromEnv,
  maxBundleUploadBytes,
  StorageTag,
  validateNamespacePart,
  validateObjectPath,
  validateUploadSize,
} from "./storage";

interface UploadAppContext {
  reqHeaders?: Headers;
  getRawBody?: () => Promise<string>;
}

const ContextSchema = z.custom<UploadAppContext>();

const VERSION_MANIFESTS_PER_LISTING = 500;
const MANIFEST_FETCH_CONCURRENCY = 8;

function parseVersionManifest(bytes: Uint8Array): WorkspaceVersionManifest | null {
  try {
    const parsed = WorkspaceVersionManifestSchema.safeParse(
      JSON.parse(new TextDecoder().decode(bytes)),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function storageErrorData() {
  return {
    errorCode: "STORAGE_PUT_FAILED",
    suggestion:
      "Check BOS_STORAGE_* (R2/MinIO) credentials and reachability on the standalone upload service",
  };
}

const invalidNamespaceFields = (input: {
  account: string;
  gateway: string;
  workspace?: string;
}): string[] =>
  [
    !validateNamespacePart(input.account, "account") ? "account" : null,
    !validateNamespacePart(input.gateway, "gateway") ? "gateway" : null,
    input.workspace !== undefined && !validateNamespacePart(input.workspace, "workspace")
      ? "workspace"
      : null,
  ].filter((field): field is string => field !== null);

export default createPlugin({
  variables: z.object({}),
  secrets: z.object({}),
  context: ContextSchema,
  contract,
  initialize: () => {
    const storage = createStorageLayerFromEnv(process.env, {
      allowMemory: process.env.NODE_ENV !== "production",
    });

    if (!storage) {
      return Effect.fail(
        new Error("BOS_STORAGE_* is required in production for the upload service"),
      );
    }

    return Effect.succeed(storage);
  },
  createRouter: (builder) => ({
    uploadStorageBundle: builder.uploadStorageBundle.effect(function* ({ input, context, errors }) {
      const storage = yield* StorageTag;

      const auth = yield* Effect.promise(() =>
        authorizeUploadRequest({
          headers: context.reqHeaders,
          account: input.account,
          gateway: input.gateway,
          permission: "write",
          config: readUploadAuthConfig(process.env),
        }),
      );
      if (!auth.authorized) {
        return yield* Effect.fail(
          auth.status === "UNAUTHORIZED"
            ? errors.UNAUTHORIZED({ message: auth.message, data: auth.data })
            : auth.status === "FORBIDDEN"
              ? errors.FORBIDDEN({ message: auth.message, data: auth.data })
              : errors.CONNECTION_ERROR({ message: auth.message, data: auth.data }),
        );
      }

      const invalidFields = invalidNamespaceFields(input);
      if (invalidFields.length > 0) {
        return yield* Effect.fail(
          errors.BAD_REQUEST({ message: "Invalid bundle namespace", data: { invalidFields } }),
        );
      }

      const maxBytes = maxBundleUploadBytes();
      const decoded: Array<{ objectPath: string; name: string; bytes: Uint8Array }> = [];
      for (const file of input.files) {
        const objectPath = validateObjectPath(file.path);
        if (!objectPath) {
          return yield* Effect.fail(
            errors.BAD_REQUEST({
              message: `Invalid bundle object path: ${file.path}`,
              data: { invalidFields: ["files"] },
            }),
          );
        }
        const buffer = Buffer.from(file.contentBase64, "base64");
        if (buffer.length === 0) {
          return yield* Effect.fail(
            errors.BAD_REQUEST({
              message: `Empty bundle file: ${file.path}`,
              data: { invalidFields: ["files"] },
            }),
          );
        }
        decoded.push({
          objectPath,
          name: objectPath.split("/").pop() ?? objectPath,
          bytes: new Uint8Array(buffer),
        });
      }

      const totalBytes = decoded.reduce((sum, file) => sum + file.bytes.byteLength, 0);
      if (!validateUploadSize(decoded, maxBytes)) {
        return yield* Effect.fail(
          errors.BAD_REQUEST({
            message: `Bundle upload exceeds the ${maxBytes} byte ceiling (${totalBytes})`,
            data: { invalidFields: ["files"] },
          }),
        );
      }

      let stored = 0;
      let unchanged = 0;
      const integrityEntries = yield* Effect.forEach(
        decoded,
        (file) =>
          Effect.gen(function* () {
            const key = buildBundleKey(
              input.account,
              input.gateway,
              input.workspace,
              file.objectPath,
            );
            const integrity = computeObjectIntegrity(file.bytes);

            const existing = yield* Effect.exit(storage.stat(key));
            if (Exit.isSuccess(existing) && existing.value?.sri === integrity) {
              unchanged += 1;
              return [file.objectPath, integrity] as const;
            }

            const put = yield* Effect.exit(
              storage.put({
                key,
                bytes: file.bytes,
                contentType: bundleContentType(file.name),
                cacheControl: bundleCacheControl(file.name),
                sri: integrity,
              }),
            );
            if (Exit.isFailure(put)) {
              return yield* Effect.fail(
                errors.CONNECTION_ERROR({
                  message: `Bundle storage failed for ${file.objectPath}: failed to store`,
                  data: storageErrorData(),
                }),
              );
            }
            stored += 1;
            return [file.objectPath, integrity] as const;
          }),
        { concurrency: 4 },
      );

      return {
        stored,
        unchanged,
        totalBytes,
        integrity: Object.fromEntries(integrityEntries),
        storage: storage.backend,
      };
    }),

    listBundles: builder.listBundles.effect(function* ({ input, context, errors }) {
      const storage = yield* StorageTag;

      const auth = yield* Effect.promise(() =>
        authorizeUploadRequest({
          headers: context.reqHeaders,
          account: input.account,
          gateway: input.gateway,
          permission: "read",
          config: readUploadAuthConfig(process.env),
        }),
      );
      if (!auth.authorized) {
        return yield* Effect.fail(
          auth.status === "UNAUTHORIZED"
            ? errors.UNAUTHORIZED({ message: auth.message, data: auth.data })
            : auth.status === "FORBIDDEN"
              ? errors.FORBIDDEN({ message: auth.message, data: auth.data })
              : errors.CONNECTION_ERROR({ message: auth.message, data: auth.data }),
        );
      }

      const invalidFields = invalidNamespaceFields(input);
      if (invalidFields.length > 0) {
        return yield* Effect.fail(
          errors.BAD_REQUEST({ message: "Invalid bundle namespace", data: { invalidFields } }),
        );
      }

      const prefix = input.workspace
        ? buildBundleKey(input.account, input.gateway, input.workspace, "")
        : `bundles/${input.account}/${input.gateway}/`;

      const listing = yield* Effect.exit(storage.list(prefix));
      if (Exit.isFailure(listing)) {
        return yield* Effect.fail(
          errors.CONNECTION_ERROR({
            message: `Bundle storage failed for ${prefix}: failed to list`,
            data: storageErrorData(),
          }),
        );
      }

      return {
        storage: storage.backend,
        prefix,
        objects: listing.value.keys,
        truncated: listing.value.truncated,
      };
    }),

    listVersions: builder.listVersions.effect(function* ({ input, context, errors }) {
      const storage = yield* StorageTag;

      const auth = yield* Effect.promise(() =>
        authorizeUploadRequest({
          headers: context.reqHeaders,
          account: input.account,
          gateway: input.gateway,
          permission: "read",
          config: readUploadAuthConfig(process.env),
        }),
      );
      if (!auth.authorized) {
        return yield* Effect.fail(
          auth.status === "UNAUTHORIZED"
            ? errors.UNAUTHORIZED({ message: auth.message, data: auth.data })
            : auth.status === "FORBIDDEN"
              ? errors.FORBIDDEN({ message: auth.message, data: auth.data })
              : errors.CONNECTION_ERROR({ message: auth.message, data: auth.data }),
        );
      }

      const invalidFields = invalidNamespaceFields(input);
      if (invalidFields.length > 0) {
        return yield* Effect.fail(
          errors.BAD_REQUEST({ message: "Invalid bundle namespace", data: { invalidFields } }),
        );
      }

      const prefix = buildBundleKey(input.account, input.gateway, input.workspace, "versions/");
      const listing = yield* Effect.exit(storage.list(prefix));
      if (Exit.isFailure(listing)) {
        return yield* Effect.fail(
          errors.CONNECTION_ERROR({
            message: `Bundle storage failed for ${prefix}: failed to list`,
            data: storageErrorData(),
          }),
        );
      }

      const manifestKeys = listing.value.keys
        .filter((entry) => entry.key.endsWith(".json"))
        .slice(0, VERSION_MANIFESTS_PER_LISTING);

      const parsed = yield* Effect.forEach(
        manifestKeys,
        (entry) =>
          Effect.gen(function* () {
            const fetched = yield* Effect.exit(storage.get(entry.key));
            if (Exit.isFailure(fetched) || !fetched.value) return null;
            const manifest = parseVersionManifest(fetched.value.bytes);
            if (!manifest) return null;
            return {
              version: manifest.version,
              entry: manifest.entry,
              entryIntegrity: manifest.entryIntegrity,
              gitSha: manifest.gitSha,
              builtAt: manifest.builtAt,
              fileCount: manifest.files ? Object.keys(manifest.files).length : undefined,
              lastModified: entry.lastModified,
            };
          }),
        { concurrency: MANIFEST_FETCH_CONCURRENCY },
      );

      const versions = parsed
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
        .sort((a, b) => {
          const aTime = a.lastModified ? Date.parse(a.lastModified) : 0;
          const bTime = b.lastModified ? Date.parse(b.lastModified) : 0;
          return bTime - aTime;
        });

      return {
        storage: storage.backend,
        versions,
        truncated: listing.value.truncated || listing.value.keys.length > manifestKeys.length,
      };
    }),

    integrityReport: builder.integrityReport.effect(function* ({ input, context, errors }) {
      const storage = yield* StorageTag;

      const auth = yield* Effect.promise(() =>
        authorizeUploadRequest({
          headers: context.reqHeaders,
          account: input.account,
          gateway: input.gateway,
          permission: "read",
          config: readUploadAuthConfig(process.env),
        }),
      );
      if (!auth.authorized) {
        return yield* Effect.fail(
          auth.status === "UNAUTHORIZED"
            ? errors.UNAUTHORIZED({ message: auth.message, data: auth.data })
            : auth.status === "FORBIDDEN"
              ? errors.FORBIDDEN({ message: auth.message, data: auth.data })
              : errors.CONNECTION_ERROR({ message: auth.message, data: auth.data }),
        );
      }

      const invalidFields = invalidNamespaceFields(input);
      if (invalidFields.length > 0) {
        return yield* Effect.fail(
          errors.BAD_REQUEST({ message: "Invalid bundle namespace", data: { invalidFields } }),
        );
      }

      const manifestKey = buildBundleKey(
        input.account,
        input.gateway,
        input.workspace,
        `versions/${input.version}.json`,
      );
      const fetched = yield* Effect.exit(storage.get(manifestKey));
      if (Exit.isFailure(fetched)) {
        return yield* Effect.fail(
          errors.CONNECTION_ERROR({
            message: `Bundle storage failed for versions/${input.version}.json: failed to fetch`,
            data: storageErrorData(),
          }),
        );
      }
      if (!fetched.value) {
        return yield* Effect.fail(
          errors.BAD_REQUEST({
            message: `Unknown version: ${input.version}`,
            data: { invalidFields: ["version"] },
          }),
        );
      }

      const manifest = parseVersionManifest(fetched.value.bytes);
      if (!manifest) {
        return yield* Effect.fail(
          errors.BAD_REQUEST({
            message: "Version manifest failed validation",
            data: { invalidFields: ["version"] },
          }),
        );
      }

      const entryKey = buildBundleKey(
        input.account,
        input.gateway,
        input.workspace,
        manifest.entry,
      );
      const entry = yield* Effect.exit(storage.get(entryKey));
      const entryVerified =
        Exit.isSuccess(entry) && entry.value
          ? computeObjectIntegrity(entry.value.bytes) === manifest.entryIntegrity
          : null;

      return {
        storage: storage.backend,
        manifest,
        entryVerified,
      };
    }),
  }),
});
