interface SessionCredentialLike {
  apiKey?: string;
  siteUrl?: string;
  accountId?: string | null;
}

export interface CdnDeployInputs {
  cdnOrigin: string | undefined;
  storageOrigin: string;
  apiKey: string | undefined;
  error?: string;
}

/**
 * CDN deploy resolution (ADR 0020): the CDN origin comes from the env or —
 * zero config — from the base runtime's inherited bundle URLs (a child's
 * resolved host slot points at the base's CDN; the root's committed config
 * says cdn.<domain> after the flip). The credential rides the `bos login`
 * session or BOS_STORAGE_API_KEY; the upload origin is the env, the
 * session's siteUrl, or the runtime's own gateway.
 */
export function resolveCdnDeployInputs(input: {
  env: Record<string, string | undefined>;
  runtimeConfig: { host?: { url?: string } } | null;
  session: SessionCredentialLike | null;
  account: string;
  gateway: string;
}): CdnDeployInputs {
  const runtimeBundleOrigin = (() => {
    try {
      const hostUrl = input.runtimeConfig?.host?.url;
      return hostUrl ? new URL(hostUrl).origin : undefined;
    } catch {
      return undefined;
    }
  })();
  const cdnOrigin = input.env.BOS_BUNDLE_CDN_ORIGIN?.replace(/\/$/, "") ?? runtimeBundleOrigin;
  const storageOrigin =
    input.env.BOS_STORAGE_ORIGIN?.replace(/\/$/, "") ??
    input.session?.siteUrl?.replace(/\/$/, "") ??
    `https://${input.gateway}`;
  const apiKey = input.env.BOS_STORAGE_API_KEY ?? input.session?.apiKey;

  if (!cdnOrigin) {
    return { cdnOrigin, storageOrigin, apiKey };
  }
  if (!apiKey) {
    return {
      cdnOrigin,
      storageOrigin,
      apiKey,
      error:
        "CDN deploy requires bundle-upload credentials — run `bos login` or set BOS_STORAGE_API_KEY",
    };
  }
  if (input.session?.accountId && input.session.accountId !== input.account) {
    return {
      cdnOrigin,
      storageOrigin,
      apiKey,
      error: `The CLI session was created for ${input.session.accountId}, but the configured account is ${input.account}. Re-run bos login under the matching account.`,
    };
  }
  return { cdnOrigin, storageOrigin, apiKey };
}
