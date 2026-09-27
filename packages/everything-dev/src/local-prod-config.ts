import type { BosConfig, BosPluginRef } from "./types";

/**
 * Local production fixtures (ADR 0009): a bos config whose production
 * remotes resolve to localhost static servers instead of deployed origins.
 *
 * `prepareLocalProductionConfig` is pure and plan-driven: a section named in
 * the plan has its production origin rewritten (when given) and its ssr URL
 * set (when given) or dropped (a local static server without an ssr variant
 * is the csr fixture); its integrity fields are dropped, because hashes bind
 * an artifact to a deployment and local artifacts change every build.
 * Sections absent from the plan stay verbatim — a mixed stack keeps a
 * genuinely remote source, its origin AND its integrity hash, untouched.
 *
 * `resolveStartConfigSource` is the `bos start --config` decision: an
 * explicit local config outranks the registry identity (BOS_ACCOUNT/
 * BOS_GATEWAY) — FastKV is fetched only when no local config was given.
 */

export interface LocalProdOriginPlan {
  host?: string;
  ui?: { production?: string; ssr?: string; name?: string; publicUrl?: string };
  api?: string;
  auth?: string;
  authUi?: { production?: string; ssr?: string; name?: string; publicUrl?: string };
  plugins?: Record<
    string,
    { production?: string; ui?: string; uiName?: string; uiPublicUrl?: string }
  >;
}

export interface StartConfigSource {
  configPath?: string;
  registry?: { account: string; domain: string };
}

export function resolveStartConfigSource(
  input: { configPath?: string; account?: string; domain?: string },
  env: { BOS_ACCOUNT?: string; BOS_GATEWAY?: string },
): StartConfigSource {
  if (input.configPath) {
    return { configPath: input.configPath };
  }
  const account = input.account ?? env.BOS_ACCOUNT;
  const domain = input.domain ?? env.BOS_GATEWAY;
  if (account && domain) {
    return { registry: { account, domain } };
  }
  return {};
}

/** A registry-fetched start is a real deployment — a localhost origin there is
 * a stray dev leftover. Local starts (explicit --config-path, bare `bos start`)
 * keep the operator's environment: their localhost origin IS the reachable
 * deployment context the in-process host's auth seam reads. */
export function isRegistryStart(source: StartConfigSource): boolean {
  return source.registry !== undefined;
}

function stripIntegrity<T extends object>(section: T): T {
  const next = { ...section } as T & { integrity?: string; ssrIntegrity?: string };
  delete next.integrity;
  delete next.ssrIntegrity;
  return next;
}

function rewriteUi<
  T extends { production?: string; ssr?: string; name?: string; publicUrl?: string },
>(
  ui: T,
  planned: { production?: string; ssr?: string; name?: string; publicUrl?: string } | undefined,
): T {
  if (!planned) return ui;
  const next = stripIntegrity(ui);
  if (planned.production !== undefined) {
    next.production = planned.production;
  }
  if (planned.ssr !== undefined) {
    next.ssr = planned.ssr;
  } else {
    delete next.ssr;
  }
  if (planned.name !== undefined) {
    next.name = planned.name;
  }
  if (planned.publicUrl !== undefined) {
    next.publicUrl = planned.publicUrl;
  }
  return next;
}

function rewritePluginRef(
  plugin: BosPluginRef,
  planned: { production?: string; ui?: string; uiName?: string; uiPublicUrl?: string } | undefined,
): BosPluginRef {
  if (!planned) return plugin;
  const next =
    planned.production !== undefined
      ? stripIntegrity({ ...plugin, production: planned.production })
      : stripIntegrity(plugin);
  if (next.ui) {
    next.ui = rewriteUi(
      { ...next.ui },
      {
        ...(planned.ui ? { production: planned.ui } : {}),
        ...(planned.uiName ? { name: planned.uiName } : {}),
        ...(planned.uiPublicUrl ? { publicUrl: planned.uiPublicUrl } : {}),
      },
    );
  }
  return next;
}

export function prepareLocalProductionConfig(
  config: BosConfig,
  plan: LocalProdOriginPlan,
): BosConfig {
  const app = { ...config.app } as BosConfig["app"];

  if (app.host && plan.host !== undefined) {
    app.host = { ...app.host, production: plan.host };
  }

  if (app.ui) {
    app.ui = rewriteUi({ ...app.ui }, plan.ui);
  }

  if (app.api && plan.api !== undefined) {
    app.api = stripIntegrity({ ...app.api, production: plan.api });
  }

  if (app.auth) {
    let auth =
      plan.auth !== undefined ? stripIntegrity({ ...app.auth, production: plan.auth }) : app.auth;
    if (auth.ui) {
      auth = { ...auth, ui: rewriteUi({ ...auth.ui }, plan.authUi) };
    }
    app.auth = auth;
  }

  let plugins = config.plugins;
  if (plugins && plan.plugins) {
    const next: BosConfig["plugins"] = {};
    for (const [key, plugin] of Object.entries(plugins)) {
      if (typeof plugin === "string") {
        next[key] = plugin;
        continue;
      }
      next[key] = rewritePluginRef(plugin, plan.plugins[key]);
    }
    plugins = next;
  }

  return { ...config, app, ...(plugins ? { plugins } : {}) };
}
