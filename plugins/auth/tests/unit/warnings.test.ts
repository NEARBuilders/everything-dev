import { describe, expect, it } from "vitest";
import type { AuthPluginSecrets, AuthPluginVariables } from "../../src/config-schemas";
import { socialProviderWarnings } from "../../src/warnings";

const variables = (
  socialProviders: unknown,
): { variables: AuthPluginVariables; secrets: AuthPluginSecrets } =>
  ({
    variables: { socialProviders } as AuthPluginVariables,
    secrets: {} as AuthPluginSecrets,
  }) as never;

describe("socialProviderWarnings", () => {
  it("is silent when every provider is fully configured", () => {
    const warnings = socialProviderWarnings({
      variables: {
        socialProviders: {
          github: { clientId: "gh-id" },
          google: { clientId: "g-id" },
        },
      } as AuthPluginVariables,
      secrets: {
        GITHUB_CLIENT_SECRET: "gh-secret",
        GOOGLE_CLIENT_SECRET: "g-secret",
      } as AuthPluginSecrets,
    });
    expect(warnings).toEqual([]);
  });

  it("names both keys when a provider is entirely unconfigured", () => {
    const warnings = socialProviderWarnings(variables(undefined));
    expect(warnings).toHaveLength(2);
    const [github, google] = warnings;
    expect(github?.message).toContain("GitHub");
    expect(github?.hint).toContain("socialProviders.github.clientId");
    expect(github?.hint).toContain("GITHUB_CLIENT_SECRET");
    expect(google?.message).toContain("Google");
    expect(google?.hint).toContain("GOOGLE_CLIENT_SECRET");
  });

  it("names the missing secret when only the client secret is absent", () => {
    const warnings = socialProviderWarnings(
      variables({ github: { clientId: "gh-id" }, google: { clientId: "g-id" } }),
    );
    expect(warnings).toHaveLength(2);
    const [github, google] = warnings;
    expect(github?.message).toContain("GITHUB_CLIENT_SECRET is not set");
    expect(github?.message).not.toContain("clientId is not set");
    expect(google?.message).toContain("GOOGLE_CLIENT_SECRET is not set");
  });

  it("names the missing variable when only the client id is absent", () => {
    const warnings = socialProviderWarnings({
      variables: {} as AuthPluginVariables,
      secrets: {
        GITHUB_CLIENT_SECRET: "gh-secret",
        GOOGLE_CLIENT_SECRET: "g-secret",
      } as AuthPluginSecrets,
    });
    expect(warnings).toHaveLength(2);
    const [github, google] = warnings;
    expect(github?.message).toContain("socialProviders.github.clientId is not set");
    expect(google?.message).toContain("socialProviders.google.clientId is not set");
  });
});
