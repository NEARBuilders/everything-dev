import { getBaseStyles, getHydrateScript, getThemeInitScript } from "everything-dev/ui/head";
import type { Context } from "hono";
import type { AuthVariables } from "../lib/auth";
import type { ClientRuntimeConfig, RuntimeConfig } from "../services/config";

type HonoEnv = { Variables: AuthVariables };

export function renderClientShell(
  ctx: Context<HonoEnv>,
  nonce: string | undefined,
  runtimeSourceConfig: RuntimeConfig,
  runtimeConfig: ClientRuntimeConfig,
  error?: Error | null,
) {
  const uiIntegrity = runtimeSourceConfig.ui.integrity;
  const assetsUrl = runtimeConfig.assetsUrl.replace(/\/$/, "");
  const nonceAttr = nonce ? ` nonce="${nonce}"` : "";
  const sriAttr = uiIntegrity ? ` integrity="${uiIntegrity}" crossorigin="anonymous"` : "";
  const uiVersion = uiIntegrity ? `?v=${encodeURIComponent(uiIntegrity)}` : "";

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
      ? `<p class="error">SSR unavailable, showing client app.</p><p>${error.message}</p>`
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

  return ctx.html(
    `<!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
          <title>${title}</title>
          <link rel="manifest" href="${assetsUrl}/site.webmanifest" />
          <link rel="stylesheet" href="${assetsUrl}/static/css/style.css${uiVersion}" />
          <style>${baseStyles}</style>
          ${themeScript}
          <script${nonceAttr} src="${assetsUrl}/remoteEntry.js${uiVersion}"${sriAttr}></script>
          <script${nonceAttr}>${hydrateScript}</script>
        </head>
        <body>${shellBody}</body>
      </html>`,
    200,
  );
}
