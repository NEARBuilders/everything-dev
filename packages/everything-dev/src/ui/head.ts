import type { ClientRuntimeConfig } from "../types";
import type { HeadScript } from "./types";

export interface RemoteScriptsOptions {
  runtimeConfig?: Partial<ClientRuntimeConfig>;
  containerName?: string;
  hydratePath?: string;
  integrity?: string;
  cspNonce?: string;
}

export function getThemeInitScript(): HeadScript {
  return {
    children:
      "(function(){var t=localStorage.getItem('theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark');}})();",
  };
}

function escapeJsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/<\/script/gi, "<\\/script")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function getHydrateScript(
  runtimeConfig: Partial<ClientRuntimeConfig> | undefined,
  containerName = "ui",
  hydratePath = "./Hydrate",
  cspNonce?: string,
): HeadScript {
  return {
    children: `
 window.__CSP_NONCE__=${cspNonce != null ? escapeJsonForScript(cspNonce) : null};
 window.__RUNTIME_CONFIG__=${escapeJsonForScript(runtimeConfig)};
  function __hydrate(){
   if (window.__EVERYTHING_DEV_HYDRATE_PROMISE__) {
     console.warn('[Hydrate] Already in progress, skipping duplicate call');
     return;
   }
   var container = window['${containerName}'];
   if (!container) {
     console.warn('[Hydrate] Container not ready yet, waiting...');
    window.__hydrateRetry = window.__hydrateRetry || 0;
    if (window.__hydrateRetry < 10) {
      window.__hydrateRetry++;
      setTimeout(__hydrate, 100);
      return;
    }
    console.error('[Hydrate] Container not found after 10 retries');
    return;
  }
  console.log('[Hydrate] Container available, starting init...');
  container.init({}).then(function(){
    return container.get('${hydratePath}');
  }).then(function(mod){
    return mod().hydrate();
  }).catch(function(e){
    console.error('[Hydrate] Failed:', e);
    window.__EVERYTHING_DEV_HYDRATE_PROMISE__ = undefined;
  });
  }
 if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',__hydrate);}else{__hydrate();}
 		`.trim(),
  };
}

export function getRemoteScripts(options: RemoteScriptsOptions): HeadScript[] {
  const { runtimeConfig, containerName, hydratePath, integrity, cspNonce } = options;
  const assetsUrl = runtimeConfig?.assetsUrl?.replace(/\/$/, "");
  const entryScript: HeadScript = {
    src: `${assetsUrl ?? ""}/remoteEntry.js${integrity ? `?v=${encodeURIComponent(integrity)}` : ""}`,
  };
  if (integrity) {
    entryScript.integrity = integrity;
    entryScript.crossOrigin = "anonymous";
  }
  return [entryScript, getHydrateScript(runtimeConfig, containerName, hydratePath, cspNonce)];
}

export function getBaseStyles(): string {
  return `
*, *::before, *::after { box-sizing: border-box; }
html { height: 100%; height: 100dvh; -webkit-text-size-adjust: 100%; text-size-adjust: 100%; color-scheme: light dark; }
body { min-height: 100%; min-height: 100dvh; margin: 0; background-color: var(--background); color: var(--foreground); -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
#root { min-height: 100vh; }
@supports (min-height: 100dvh) { #root { min-height: 100dvh; } }
  `.trim();
}
