#!/usr/bin/env bun
/**
 * Deployment container entrypoint (ADR 0009 amendment): serves the staged
 * dist servers on the container's own localhost, picks the render-variant
 * runtime config, and boots the real production host (`bos start
 * --config-path`). REGRESSION_VARIANT selects ssr | csr (default ssr) —
 * the name is harness heritage; the deployment boots the ssr default.
 *
 * Zero runtime dependencies — node builtins only — so the runtime stage
 * stays free of hoisted-transitive assumptions.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import process from "node:process";

const root = "/app";
const imageDir = path.join(root, ".bos", "regression", "image");
const variant = process.env.REGRESSION_VARIANT === "csr" ? "csr" : "ssr";

const layout = JSON.parse(readFileSync(path.join(imageDir, "layout.json"), "utf8"));
const configPath = path.join(imageDir, layout.configs[variant]);

const MIME_TYPES = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "application/javascript",
  ".json": "application/json",
  ".map": "application/json",
  ".mjs": "application/javascript",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};

const servers = [];

const serve = (dir, port, basePath = "") => {
  const rootDir = path.join(imageDir, dir);
  const prefix = basePath.replace(/\/$/, "");
  const server = createServer((req, res) => {
    const relative = (req.url ?? "/").split("?")[0] || "/";
    if (prefix && !(relative === prefix || relative.startsWith(`${prefix}/`))) {
      res.statusCode = 404;
      res.setHeader("content-type", "text/plain");
      res.end("Not Found");
      return;
    }
    const filePath = path.resolve(rootDir, `.${prefix ? relative.slice(prefix.length) : relative}`);
    if (!filePath.startsWith(rootDir)) {
      res.statusCode = 403;
      res.end("forbidden");
      return;
    }
    try {
      const body = readFileSync(filePath);
      res.statusCode = 200;
      res.setHeader("access-control-allow-origin", "*");
      res.setHeader(
        "content-type",
        MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream",
      );
      res.end(body);
    } catch {
      res.statusCode = 404;
      res.setHeader("content-type", "text/plain");
      res.end("Not Found");
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => {
      console.log(`[runtime] serving ${dir} → http://localhost:${port}${prefix}`);
      servers.push(server);
      resolve();
    });
  });
};

const hostPort = layout.basePort;

const main = async () => {
  for (const { dir, port, basePath } of layout.servers) {
    await serve(dir, port, basePath);
  }

  console.log(`[runtime] variant ${variant} — config ${path.basename(configPath)}`);
  const child = spawn(
    process.execPath,
    [
      "./node_modules/everything-dev/dist/cli.mjs",
      "start",
      "--config-path",
      configPath,
      "--no-interactive",
      "--port",
      String(hostPort),
    ],
    { cwd: root, stdio: "inherit", env: process.env },
  );

  const teardown = (signal = "SIGTERM") => {
    try {
      child.kill(signal);
    } catch {
      /* already gone */
    }
    for (const server of servers) server.close();
  };
  process.on("SIGTERM", () => teardown());
  process.on("SIGINT", () => teardown());
  process.on("exit", () => {
    try {
      child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  });
  child.on("exit", (code) => {
    for (const server of servers) server.close();
    process.exitCode = code ?? 1;
  });

  const deadline = Date.now() + 180_000;
  let ready = false;
  while (Date.now() < deadline && !ready) {
    try {
      const res = await fetch(`http://localhost:${hostPort}/health`);
      ready = res.ok;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (!ready) {
    console.error(`[runtime] host never became healthy at http://localhost:${hostPort}/health`);
    teardown();
    process.exit(1);
  }
  console.log(`[runtime] production stack (${variant}) ready at http://localhost:${hostPort}`);
};

main().catch((error) => {
  console.error("[runtime] fatal:", error);
  process.exit(1);
});
