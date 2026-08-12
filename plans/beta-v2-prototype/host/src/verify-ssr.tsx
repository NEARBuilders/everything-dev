import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { RouterServer, createRequestHandler, renderRouterToStream } from "@tanstack/react-router/ssr/server";
import type { AnyRoute } from "@tanstack/react-router";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { composeApp, type WebPluginModule } from "./compose";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// tsx transpiles remote .tsx files with the classic JSX runtime (a global
// `React`); plugin workspace builds use the automatic runtime. For this
// headless harness, expose React globally so remote components render.
(globalThis as Record<string, unknown>).React = (await import("react")).default;

async function importRemoteTree(remoteName: string): Promise<WebPluginModule> {
  const entry = path.resolve(__dirname, `../../remote-${remoteName}/src/tree.tsx`);
  const mod = await import(pathToFileURL(entry).href);
  return { name: remoteName, tree: mod.tree ?? {} } as WebPluginModule;
}

/**
 * SSR proof: the host composes plugin trees server-side and renders the merged
 * route tree through `createRequestHandler` + `renderRouterToStream`. This is
 * the exact pipeline the everything.dev host would run per request — no browser,
 * no MF networking, deterministic.
 */
async function renderPath(url: string, routeTree: AnyRoute): Promise<string> {
  const request = new Request(url);
  const handler = createRequestHandler({
    request,
    createRouter: () =>
      createRouter({
        routeTree,
        history: createMemoryHistory(),
        context: {},
      }),
  });

  const response = await handler(({ request, responseHeaders, router }) =>
    renderRouterToStream({
      request,
      responseHeaders,
      router,
      children: <RouterServer router={router} />,
    }),
  );

  return await new Response(response.body).text();
}

async function main() {
  const plugins: WebPluginModule[] = [
    await importRemoteTree("landing"),
    await importRemoteTree("dashboard"),
    await importRemoteTree("settings"),
    await importRemoteTree("filebased"),
  ];

  const { routeTree } = composeApp(plugins);

  console.log("=== SSR: composed tree rendered to HTML (no browser) ===\n");

  const CASES = [
    ["/", "Landing index (/)", "host · mount point: public"],
    ["/about", "About (/about)", "host · mount point: public"],
    ["/dashboard", "Dashboard (/dashboard)", "host · mount point: public"],
    ["/dashboard/analytics", "Analytics (/dashboard/analytics)", "host · mount point: public"],
    ["/settings", "Settings (/settings)", "host · mount point: auth"],
    ["/settings/profile", "Profile (/settings/profile)", "host · mount point: auth"],
    ["/admin/users", "Admin Users (/admin/users)", "host · mount point: admin"],
    ["/blog", "File-based blog index (/blog)", "host · mount point: public"],
    ["/blog/hello-world", "Blog post: hello-world", "host · mount point: public"],
    ["/account", "Account (/account)", "host · mount point: auth"],
  ] as const;

  let failures = 0;
  for (const [urlPath, expectedText, expectedMount] of CASES) {
    const html = await renderPath(`http://localhost:3000${urlPath}`, routeTree);
    // React SSR inserts `<!-- -->` comment nodes between adjacent text spans —
    // strip them so substring assertions match rendered text.
    const text = html.replaceAll(/<!-- -->/g, "");
    const ok = text.includes(expectedText) && text.includes(expectedMount);
    if (!ok) failures += 1;
    console.log(
      `  ${ok ? "ok" : "FAIL"}  ${urlPath.padEnd(26)} [${expectedMount.replace("host · mount point: ", "")}] contains "${expectedText}"`,
    );
  }

  console.log(
    `\n=== SSR RESULT: ${failures === 0 ? `PASS — ${CASES.length}/${CASES.length} grafted routes SSR-render with host mount chrome` : `${failures} FAILURES`} ===`,
  );

  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("SSR verify crashed:", err);
  process.exit(1);
});
