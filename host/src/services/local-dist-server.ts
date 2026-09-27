import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import path from "node:path";

export interface LocalDistServer {
  baseUrl: string;
  stop: () => Promise<void>;
}

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css",
  ".html": "text/html",
  ".ico": "image/x-icon",
  ".js": "application/javascript",
  ".json": "application/json",
  ".mjs": "application/javascript",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".webmanifest": "application/manifest+json",
};

const contentTypeOf = (filePath: string) =>
  MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";

/**
 * Serves a built ui dist directory over loopback HTTP so the host's standard
 * remote-loading flow can consume the local node container. Dev only —
 * production ui sources always arrive over HTTP from the CDN.
 */
export async function startLocalDistServer(rootDir: string): Promise<LocalDistServer> {
  const normalizedRoot = path.resolve(rootDir);

  const server: Server = createServer((req, res) => {
    const relativePath = (req.url ?? "/").split("?")[0] || "/";
    const filePath = path.resolve(normalizedRoot, `.${relativePath}`);

    if (!filePath.startsWith(normalizedRoot)) {
      res.statusCode = 403;
      res.end("forbidden");
      return;
    }

    if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
      res.statusCode = 404;
      res.setHeader("content-type", "text/plain");
      res.end("Not Found");
      return;
    }

    res.statusCode = 200;
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("content-type", contentTypeOf(filePath));
    res.end(readFileSync(filePath));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    stop: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
