import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { RouterServer, createRequestHandler, renderRouterToStream } from "@tanstack/react-router/ssr/server";
import type { AnyRoute } from "@tanstack/react-router";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { composeApp, type WebPluginModule } from "./compose";
import { MOCK_ADMIN_USER } from "./mount-registry";

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
 *
 * Session-gated mounts (authenticated, admin, organization) are `ssr: false`:
 * the server renders NOTHING for their subtrees. That is the point — SSR never
 * sees session-dependent content, so the server needs no session resolution.
 * Public mounts SSR normally with full content.
 */
async function renderPath(url: string, routeTree: AnyRoute): Promise<string> {
  const request = new Request(url);
  const handler = createRequestHandler({
    request,
    createRouter: () =>
      createRouter({
        routeTree,
        history: createMemoryHistory(),
        context: MOCK_ADMIN_USER,
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
    await importRemoteTree("org"),
  ];

  const { routeTree } = composeApp(plugins);

  console.log("=== SSR: composed tree rendered to HTML (no browser) ===\n");

  // contentExpected: true → the full plugin content must appear server-side.
  // contentExpected: false → the mount is ssr:false, so the server renders
  // nothing for the subtree (mount chrome + plugin content both absent).
  const CASES = [
    ["/", "Landing index (/)", "host · mount point: public", true],
    ["/about", "About (/about)", "host · mount point: public", true],
    ["/dashboard", "Dashboard (/dashboard)", "host · mount point: public", true],
    ["/dashboard/analytics", "Analytics (/dashboard/analytics)", "host · mount point: public", true],
    ["/blog", "File-based blog index (/blog)", "host · mount point: public", true],
    ["/blog/hello-world", "Blog post: hello-world", "host · mount point: public", true],
    ["/settings", "Settings (/settings)", "host · mount point: authenticated", false],
    ["/settings/profile", "Profile (/settings/profile)", "host · mount point: authenticated", false],
    ["/admin/users", "Admin Users (/admin/users)", "host · mount point: admin", false],
    ["/account", "Account (/account)", "host · mount point: authenticated", false],
    ["/organization/acme/dashboard", "Org Dashboard", "host · mount point: organization", false],
  ] as const;

  let failures = 0;
  for (const [urlPath, expectedText, expectedMount, contentExpected] of CASES) {
    const html = await renderPath(`http://localhost:3000${urlPath}`, routeTree);
    // React SSR inserts `<!-- -->` comment nodes between adjacent text spans —
    // strip them so substring assertions match rendered text.
    const text = html.replaceAll(/<!-- -->/g, "");
    const hasMount = text.includes(expectedMount);
    const hasContent = text.includes(expectedText);
    const ok = contentExpected ? hasMount && hasContent : !hasMount && !hasContent;
    if (!ok) failures += 1;
    console.log(
      `  ${ok ? "ok" : "FAIL"}  ${urlPath.padEnd(26)} [${expectedMount.replace("host · mount point: ", "")}] ${contentExpected ? `contains "${expectedText}"` : `ssr:false — subtree NOT rendered (content absent: ${!hasContent}, chrome absent: ${!hasMount})`}`,
    );
  }

  console.log(
    `\n=== SSR RESULT: ${failures === 0 ? `PASS — ${CASES.length}/${CASES.length} cases: public mounts SSR fully, session-gated mounts SSR-excluded by design` : `${failures} FAILURES`} ===`,
  );

  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("SSR verify crashed:", err);
  process.exit(1);
});
