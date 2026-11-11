import type { PluginWarningInfo } from "every-plugin/errors";
import type { AuthPluginSecrets, AuthPluginVariables } from "./config-schemas";

type SocialProviderCheck = {
  label: string;
  clientId: string | undefined;
  clientSecret: string | undefined;
  clientIdVariable: string;
  clientSecretName: string;
  clientIdEnvVar: string;
};

function socialProviderWarning(provider: SocialProviderCheck): PluginWarningInfo | null {
  const enable = `to enable ${provider.label} social sign-in`;
  if (provider.clientId && provider.clientSecret) return null;
  if (provider.clientId) {
    return {
      pluginKey: "auth",
      message: `${provider.label} social sign-in is disabled — ${provider.clientSecretName} is not set`,
      hint: `Add ${provider.clientSecretName} to your environment (.env in development) ${enable}`,
    };
  }
  if (provider.clientSecret) {
    return {
      pluginKey: "auth",
      message: `${provider.label} social sign-in is disabled — ${provider.clientIdVariable} is not set`,
      hint: `Set ${provider.clientIdVariable} in the authored config (or ${provider.clientIdEnvVar} in your .env in development) ${enable}`,
    };
  }
  return {
    pluginKey: "auth",
    message: `${provider.label} social sign-in is disabled — OAuth credentials are not configured`,
    hint: `Set ${provider.clientIdVariable} in the authored config (or ${provider.clientIdEnvVar} in your .env in development) and ${provider.clientSecretName} in your .env ${enable}`,
  };
}

export function socialProviderWarnings(config: {
  variables: AuthPluginVariables;
  secrets: AuthPluginSecrets;
}): PluginWarningInfo[] {
  const providers = config.variables.socialProviders;
  return [
    socialProviderWarning({
      label: "GitHub",
      clientId: providers?.github?.clientId,
      clientSecret: config.secrets.GITHUB_CLIENT_SECRET,
      clientIdVariable: "socialProviders.github.clientId",
      clientSecretName: "GITHUB_CLIENT_SECRET",
      clientIdEnvVar: "GITHUB_CLIENT_ID",
    }),
    socialProviderWarning({
      label: "Google",
      clientId: providers?.google?.clientId,
      clientSecret: config.secrets.GOOGLE_CLIENT_SECRET,
      clientIdVariable: "socialProviders.google.clientId",
      clientSecretName: "GOOGLE_CLIENT_SECRET",
      clientIdEnvVar: "GOOGLE_CLIENT_ID",
    }),
  ].filter((warning): warning is PluginWarningInfo => warning !== null);
}

function authBaseUrlHost(baseUrl: string | undefined): string | null {
  if (!baseUrl) return null;
  const candidate = /^https?:\/\//i.test(baseUrl) ? baseUrl : `https://${baseUrl}`;
  try {
    return new URL(candidate).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isLoopbackHost(host: string): boolean {
  return (
    host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost")
  );
}

/**
 * crossSubDomainCookies (#668) fails silently at the browser: a Set-Cookie
 * whose Domain does not cover the app's own host is dropped outright (sign-in
 * stops working), and localhost hosts can never carry a Domain attribute.
 * Both misconfigurations are caught at config time here instead.
 */
export function cookieDomainWarnings(config: {
  variables: AuthPluginVariables;
}): PluginWarningInfo[] {
  const cookies = config.variables.crossSubDomainCookies;
  if (!cookies?.enabled) return [];
  const host = authBaseUrlHost(config.variables.baseUrl);
  if (!host) return [];
  const warnings: PluginWarningInfo[] = [];
  if (isLoopbackHost(host)) {
    warnings.push({
      pluginKey: "auth",
      message:
        "crossSubDomainCookies is enabled but the auth baseUrl is a localhost host — browsers refuse Domain cookies for local hosts, so sessions stay host-scoped in this environment",
      hint: "Exercise cross-domain session sharing on a staging deployment whose hosts share the configured registrable domain instead",
    });
  }
  if (cookies.domain) {
    const domain = cookies.domain.toLowerCase().replace(/^\./, "");
    const coversHost = host === domain || host.endsWith(`.${domain}`);
    if (!coversHost) {
      warnings.push({
        pluginKey: "auth",
        message: `crossSubDomainCookies.domain "${cookies.domain}" does not cover the auth baseUrl host "${host}" — browsers drop cookies scoped to a foreign domain, which breaks sign-in on this app`,
        hint: `Use a dot-prefixed registrable domain that is a suffix of "${host}" (e.g. ".${host.split(".").slice(-2).join(".")}")`,
      });
    }
  }
  return warnings;
}
