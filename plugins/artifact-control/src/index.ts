import { Effect, Exit } from "effect";
import { createPlugin } from "every-plugin";
import { z } from "zod";
import {
  authorizeUploadRequest,
  readUploadAuthConfig,
} from "./auth";
import { contract } from "./contract";
import {
  StorageTag,
  createStorageLayerFromEnv,
  buildBundleKey,
  bundleCacheControl,
  bundleContentType,
  computeObjectIntegrity,
  maxBundleUploadBytes,
  validateNamespacePart,
  validateObjectPath,
  validateUploadSize,
} from "./storage";

interface ArtifactControlContext {
  reqHeaders?: Headers;
  getRawBody?: () => Promise<string>;
}

const ContextSchema = z.custom<ArtifactControlContext>();

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
        new Error("BOS_STORAGE_* is required in production for the artifact-control service"),
      );
    }

    return Effect.succeed(storage);
  },
  createRouter: (builder) => ({
    uploadStorageBundle: builder.uploadStorageBundle.effect(function* ({ input, context, errors }) {
      const storage = yield* StorageTag;
      const authResult = yield* Effect.promise(() =>
        authorizeUploadRequest({
          headers: context.reqHeaders,
          account: input.account,
          gateway: input.gateway,
          config: readUploadAuthConfig(process.env),
        }),
      );

      if (!authResult.authorized) {
        switch (authResult.status) {
          case "UNAUTHORIZED":
            return yield* Effect.fail(
              errors.UNAUTHORIZED({
                message: authResult.message,
                data: authResult.data,
              }),
            );
          case "FORBIDDEN":
            return yield* Effect.fail(
              errors.FORBIDDEN({
                message: authResult.message,
                data: authResult.data,
              }),
            );
          case "CONNECTION_ERROR":
            return yield* Effect.fail(
              errors.CONNECTION_ERROR({
                message: authResult.message,
                data: authResult.data,
              }),
            );
        }
      }

      const invalidFields = [
        !validateNamespacePart(input.account, "account") ? "account" : null,
        !validateNamespacePart(input.gateway, "gateway") ? "gateway" : null,
        !validateNamespacePart(input.workspace, "workspace") ? "workspace" : null,
      ].filter((field): field is string => field !== null);
      if (invalidFields.length > 0) {
        return yield* Effect.fail(
          errors.BAD_REQUEST({
            message: "Invalid bundle namespace",
            data: { invalidFields },
          }),
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

      const integrityEntries = yield* Effect.forEach(
        decoded,
        (file) =>
          Effect.gen(function* () {
            const put = yield* Effect.exit(
              storage.put({
                key: buildBundleKey(input.account, input.gateway, input.workspace, file.objectPath),
                bytes: file.bytes,
                contentType: bundleContentType(file.name),
                cacheControl: bundleCacheControl(file.name),
              }),
            );
             if (Exit.isFailure(put)) {
              return yield* Effect.fail(
                errors.CONNECTION_ERROR({
                  message: `Bundle storage failed for ${file.objectPath}: failed to store`,
                  data: {
                    errorCode: "STORAGE_PUT_FAILED",
                    suggestion:
                      "Check BOS_STORAGE_* (R2/MinIO) credentials and reachability on the standalone artifact-control service",
                  },
                }),
              );
            }
            return [file.objectPath, computeObjectIntegrity(file.bytes)] as const;
          }),
        { concurrency: 4 },
      );

      return {
        sessionId: input.sessionId,
        stored: decoded.length,
        totalBytes,
        integrity: Object.fromEntries(integrityEntries),
        storage: storage.backend,
      };
    }),
  }),
});
