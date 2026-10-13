import "dotenv/config";
import { OpenAPIGenerator } from "@orpc/openapi";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferenceHandlerPlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { ResponseHeadersHandlerPlugin } from "@orpc/server/plugins";
import { ZodToJsonSchemaConverter } from "@orpc/zod";
import { createPluginRuntime } from "every-plugin";
import { startDirectModuleHost } from "every-plugin/dev-host";
import { readUploadAuthConfig, validateUploadAuthConfig } from "./src/auth";
import Plugin from "./src/index";
import { resolveStorageConfigFromEnv } from "./src/storage";

const port = Number(process.env.PORT) || 3014;
const isProduction = process.env.NODE_ENV === "production";

const authConfig = readUploadAuthConfig(process.env);
const authConfigError = validateUploadAuthConfig(authConfig, { production: isProduction });
if (authConfigError) {
  throw new Error(authConfigError);
}

if (isProduction && !resolveStorageConfigFromEnv(process.env)) {
  throw new Error("BOS_STORAGE_* is required in production for the upload service");
}

const runtime = createPluginRuntime({
  registry: { upload: { module: Plugin } },
});

const loaded = await runtime.usePlugin("upload", { variables: {}, secrets: {} });

const handlers: { rpc: any; api: any } = { rpc: null, api: null };
const effectContextHolder: { context: unknown } = { context: loaded.initialized.effectContext };

handlers.api = new OpenAPIHandler(loaded.router, {
  errorStatusMap: {},
  plugins: [
    new ResponseHeadersHandlerPlugin(),
    new OpenAPIReferenceHandlerPlugin({
      spec: () =>
        new OpenAPIGenerator({ converters: [new ZodToJsonSchemaConverter()] }).generate(
          loaded.router,
          {
            version: "3.1.1",
            base: {
              info: {
                title: "upload",
                version: "1.0.0",
              },
              servers: [{ url: "/api" }],
            },
          },
        ),
    }),
  ],
  interceptors: [
    onError((error: unknown) => {
      throw error;
    }),
  ],
});

const host = await startDirectModuleHost({
  name: "upload",
  version: "1.0.0",
  handlers,
  effectContext: () => effectContextHolder.context,
  port,
});

console.log(`upload listening on ${host.port}`);
