import { getBaseStyles, getHydrateScript, getThemeInitScript } from "everything-dev/ui/head";
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

  const pluginUiScripts = (
    runtimeConfig.ui?.compose
      ? Object.values(runtimeConfig.plugins ?? {}).flatMap((plugin) => {
          const ui = plugin?.ui;
          if (!ui?.url) return [];
          const pluginVersion = ui.integrity ? `?v=${encodeURIComponent(ui.integrity)}` : "";
          const pluginSri = ui.integrity ? ` integrity="${ui.integrity}"` : "";
          return [
            `<script${nonceAttr} src="${ui.url.replace(/\/$/, "")}/remoteEntry.js${pluginVersion}" crossorigin="anonymous"${pluginSri}></script>`,
          ];
        })
      : []
  ).join("\n          ");

  const baseStyles = `
    ${getBaseStyles()}
    .shell { min-height: 100vh; min-height: 100dvh; display: flex; align-items: center; justify-content: center; }
    .fade { animation: fadeIn 0.3s ease-in; }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    .error { color: #fca5a5; }
  `.trim();

  const themeScript = `<script${nonceAttr}>${(getThemeInitScript() as { children?: string }).children ?? ""}</script>`;

  const shellBody = `<div id="root"><div class="shell"><div class="fade">${
    error
      ? `<p class="error">SSR unavailable, showing client app.</p><p>${escapeHtml(error.message)}${requestId ? `<br /><small>(request ${escapeHtml(requestId)})</small>` : ""}</p>`
      : `<p>Loading...</p>`
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
          <script${nonceAttr} src="${assetsUrl}/remoteEntry.js${uiVersion}"${sriAttr}></script>
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
