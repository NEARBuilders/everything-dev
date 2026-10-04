/**
 * Tiny static server for built remote bundles — serves each remote's dist
 * ROOT (web remoteEntry.js at /, node SSR at /ssr/). 404s are logged with
 * the resolved path so a missing file is visible in this terminal.
 *
 * usage: bun src/serve.ts <port> <distRoot> [<port> <distRoot>]...
 */
import path from "node:path";

const args = process.argv.slice(2);

for (let i = 0; i < args.length; i += 2) {
  const port = Number(args[i]);
  const rootDir = path.resolve(args[i + 1]!);
  Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const file = Bun.file(`${rootDir}${url.pathname}`);
      if (await file.exists()) return new Response(file);
      console.warn(`[serve] 404 ${url.pathname} (root: ${rootDir})`);
      return new Response(`// not found: ${rootDir}${url.pathname}`, { status: 404 });
    },
  });
  console.log(`serving ${rootDir} at http://localhost:${port}`);
}

process.on("SIGTERM", () => process.exit(0));
