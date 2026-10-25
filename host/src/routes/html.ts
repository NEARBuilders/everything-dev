import { getBaseStyles, getHydrateScript, getThemeInitScript } from "everything-dev/ui/head";
import { type EntrySlot, entryUrls } from "everything-dev/ui/manifest";
import type { ClientRuntimeConfig, RuntimeConfig } from "../services/config";

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export function renderClientShellHtml(
  nonce: string | undefined,
  runtimeSourceConfig: RuntimeConfig,
  runtimeConfig: ClientRuntimeConfig,
  error?: Error | null,
  requestId?: string,
): string {
  const uiIntegrity = runtimeSourceConfig.ui.integrity;
  const assetsUrl = runtimeConfig.assetsUrl.replace(/\/$/, "");
  const nonceAttr = nonce ? ` nonce="${nonce}"` : "";
  const sriAttr = ` crossorigin="anonymous"${uiIntegrity ? ` integrity="${uiIntegrity}"` : ""}`;
  const uiVersion = uiIntegrity ? `?v=${encodeURIComponent(uiIntegrity)}` : "";
  const coreEntrySrc = entryUrls(runtimeSourceConfig.ui, runtimeSourceConfig.env).web;

  const pluginScripts = runtimeConfig.ui?.compose
    ? Object.values(runtimeConfig.plugins ?? {}).flatMap((plugin) => {
        const ui = plugin?.ui;
        if (!ui?.url) return [];
        const pluginSri = ui.integrity ? ` integrity="${ui.integrity}"` : "";
        const pluginSrc = entryUrls(
          { ...ui, name: plugin.name } satisfies EntrySlot,
          runtimeSourceConfig.env,
        ).web;
        return [{ src: pluginSrc, sri: pluginSri }];
      })
    : [];
  const pluginUiScripts = pluginScripts
    .map(
      ({ src, sri }) => `<script${nonceAttr} src="${src}" crossorigin="anonymous"${sri}></script>`,
    )
    .join("\n          ");

  // Module scripts are CORS-fetched — preconnect each distinct entry origin
  // so the browser's compose chain starts its connections at head parse.
  const originOf = (src: string): string | null => {
    try {
      return new URL(src).origin;
    } catch {
      return null;
    }
  };
  const preconnectLinks = [
    ...new Set(
      [coreEntrySrc, ...pluginScripts.map(({ src }) => src)]
        .map(originOf)
        .filter((origin): origin is string => origin !== null),
    ),
  ]
    .map((origin) => `<link rel="preconnect" href="${origin}" crossorigin="anonymous" />`)
    .join("\n          ");

  const baseStyles = `
    ${getBaseStyles()}
    .shell { min-height: 100vh; min-height: 100dvh; display: flex; align-items: center; justify-content: center; }
    .fade { animation: fadeIn 0.3s ease-in; }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    .error { color: var(--destructive); }
  `.trim();

  const themeScript = `<script${nonceAttr}>${(getThemeInitScript() as { children?: string }).children ?? ""}</script>`;

  const bootShell = `<div class="fade flex flex-col items-center gap-3" role="status" aria-label="Loading">
            <div class="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/25 border-t-muted-foreground"></div>
            <p class="text-sm text-muted-foreground">Loading…</p>
          </div>`;

  const shellBody = `<div id="root"><div class="shell"><div class="fade">${
    error
      ? `<p class="error">SSR unavailable, showing client app.</p><p>${escapeHtml(error.message)}${requestId ? `<br /><small>(request ${escapeHtml(requestId)})</small>` : ""}</p>`
      : bootShell
  }</div></div></div>`;

  const title =
    runtimeConfig.runtime?.title ?? runtimeSourceConfig.title ?? runtimeSourceConfig.account;
  const hydrateScript =
    (
      getHydrateScript(
        runtimeConfig as Partial<ClientRuntimeConfig>,
        undefined,
        undefined,
        nonce,
      ) as { children?: string }
    ).children ?? "";

  return `<!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
          <title>${escapeHtml(title)}</title>
          <link rel="manifest" href="${assetsUrl}/site.webmanifest" />
          <link rel="stylesheet" href="${assetsUrl}/static/css/style.css${uiVersion}" />
          <style>${baseStyles}</style>
          ${themeScript}
          ${preconnectLinks}
          <script${nonceAttr} src="${coreEntrySrc}"${sriAttr}></script>
          ${pluginUiScripts}
          <script${nonceAttr}>${hydrateScript}</script>
        </head>
        <body>${shellBody}</body>
      </html>`;
}

export function renderClientShell(
  nonce: string | undefined,
  runtimeSourceConfig: RuntimeConfig,
  runtimeConfig: ClientRuntimeConfig,
  error?: Error | null,
  cspHeader?: string | null,
  requestId?: string,
): Response {
  const headers = new Headers({ "content-type": "text/html; charset=UTF-8" });
  if (cspHeader) {
    headers.set("Content-Security-Policy", cspHeader);
  }
  if (requestId) {
    headers.set("x-request-id", requestId);
  }
  return new Response(
    renderClientShellHtml(nonce, runtimeSourceConfig, runtimeConfig, error, requestId),
    {
      status: 200,
      headers,
    },
  );
}
