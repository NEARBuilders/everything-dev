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
