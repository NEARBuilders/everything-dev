import type http from "node:http";
import { createServer } from "node:http";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "X-Requested-With, content-type, Authorization",
};

const applyCorsHeaders = (res: http.ServerResponse) => {
  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
};

const sendJson = (res: http.ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
};

const sendText = (res: http.ServerResponse, status: number, text: string) => {
  res.statusCode = status;
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.end(text);
};

const pathnameOf = (req: http.IncomingMessage): string =>
  ((req.url ?? "/").split("?")[0] ?? "/").replace(/\/+$/, "") || "/";

const toWebRequest = (req: http.IncomingMessage, port: number): Request => {
  const url = `http://localhost:${port}${req.url}`;
  return new Request(url, {
    method: req.method,
    headers: req.headers,
    body: req.method !== "GET" && req.method !== "HEAD" ? req : undefined,
    duplex: req.method !== "GET" && req.method !== "HEAD" ? "half" : undefined,
  } as RequestInit);
};

const buildHostContext = (
  effectContext: unknown,
  webRequest: Request,
  cachedRawBodyRef: { value: string | null },
) => {
  const rawClone =
    webRequest.method === "GET" || webRequest.method === "HEAD" ? null : webRequest.clone();

  return {
    reqHeaders: webRequest.headers,
    "effect/context": effectContext,
    getRawBody: async (): Promise<string> => {
      if (cachedRawBodyRef.value !== null) return cachedRawBodyRef.value;
      if (!rawClone) {
        cachedRawBodyRef.value = "";
        return cachedRawBodyRef.value;
      }
      cachedRawBodyRef.value = await rawClone.text();
      return cachedRawBodyRef.value;
    },
  };
};

const handleOrpc = async (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  handler: any,
  prefix: string,
  errorLabel: string,
  effectContext: unknown,
  port: number,
) => {
  try {
    const webRequest = toWebRequest(req, port);
    const cachedRawBodyRef = { value: null as string | null };
    const result = await handler.handle(webRequest, {
      prefix,
      context: buildHostContext(effectContext, webRequest, cachedRawBodyRef),
    });

    if (result.response) {
      res.statusCode = result.response.status;
      result.response.headers.forEach((value: string, key: string) => {
        res.setHeader(key, value);
      });
      const text = await result.response.text();
      if (!res.getHeader("content-length")) {
        res.setHeader("content-length", Buffer.byteLength(text).toString());
      }
      res.end(text);
    } else {
      sendText(res, 404, "Not Found");
    }
  } catch (error) {
    console.error(`${errorLabel} error:`, error);
    sendJson(res, 500, { error: (error as Error).message });
  }
};

export interface DirectModuleHostHandlers {
  rpc: any | null;
  api: any | null;
}

export interface DirectModuleHostOptions {
  name: string;
  handlers: DirectModuleHostHandlers;
  effectContext: unknown | (() => unknown);
  port?: number;
  version?: string;
  rpcPrefix?: `/${string}`;
  apiPrefix?: `/${string}`;
  staticHandler?:
    | ((req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => void)
    | null;
}

export interface DirectModuleHostHandle {
  port: number;
  close: () => Promise<void>;
}

export async function startDirectModuleHost(
  options: DirectModuleHostOptions,
): Promise<DirectModuleHostHandle> {
  const port = options.port ?? 0;
  let resolvedPort = port;
  const rpcPrefix = options.rpcPrefix ?? "/api/rpc";
  const apiPrefix = options.apiPrefix ?? "/api";
  const staticHandler = options.staticHandler ?? null;
  const resolveEffectContext =
    typeof options.effectContext === "function"
      ? options.effectContext
      : () => options.effectContext;

  const server = createServer((req, res) => {
    applyCorsHeaders(res);
    const pathname = pathnameOf(req);

    if (req.method === "OPTIONS") {
      res.statusCode = 200;
      res.end();
      return;
    }

    if (pathname === "/" && (req.method === "GET" || req.method === "HEAD")) {
      sendJson(res, 200, {
        ok: true,
        module: options.name,
        version: options.version,
        status: options.handlers.rpc ? "ready" : "loading",
        endpoints: {
          health: "/health",
          docs: apiPrefix,
          rpc: rpcPrefix,
        },
      });
      return;
    }

    if (pathname === "/health" && (req.method === "GET" || req.method === "HEAD")) {
      sendText(res, 200, "OK");
      return;
    }

    if (pathname.startsWith(`${rpcPrefix}/`)) {
      if (!options.handlers.rpc) {
        sendJson(res, 503, { error: "Plugin still loading..." });
        return;
      }
      handleOrpc(
        req,
        res,
        options.handlers.rpc,
        rpcPrefix,
        "RPC",
        resolveEffectContext(),
        resolvedPort,
      ).catch(() => {});
      return;
    }

    if (pathname === apiPrefix || pathname.startsWith(`${apiPrefix}/`)) {
      if (!options.handlers.api) {
        sendJson(res, 503, { error: "Plugin still loading..." });
        return;
      }
      handleOrpc(
        req,
        res,
        options.handlers.api,
        apiPrefix,
        "OpenAPI",
        resolveEffectContext(),
        resolvedPort,
      ).catch(() => {});
      return;
    }

    if (staticHandler) {
      staticHandler(req, res, () => {
        sendText(res, 404, "Not Found");
      });
      return;
    }

    sendText(res, 404, "Not Found");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("Failed to resolve host port");
  }
  resolvedPort = address.port;

  return {
    port: resolvedPort,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
