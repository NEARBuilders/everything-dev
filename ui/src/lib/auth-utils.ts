const PROVIDER_CONFIG: Record<string, { name: string; icon: string }> = {
  siwn: { name: "NEAR", icon: "🔗" },
  google: { name: "Google", icon: "🔵" },
  github: { name: "GitHub", icon: "⚫" },
  email_password: { name: "Email", icon: "📧" },
  anonymous: { name: "Anonymous", icon: "👻" },
};

export function getLinkedProviders(accounts: any[]): string[] {
  const providers = new Set<string>();
  for (const account of accounts) {
    const providerId = getAccountProviderId(account);
    if (providerId !== "unknown") {
      providers.add(providerId);
    }
  }
  return Array.from(providers);
}

export function getNearAccountId(accounts: any[]): string | null {
  const nearAccount = accounts.find((a: any) => getAccountProviderId(a) === "siwn");
  if (!nearAccount) return null;
  const accountId: string = nearAccount.accountId ?? "";
  return accountId.includes(":") ? accountId.split(":")[0] : accountId;
}

export function getProviderConfig(providerId: string): { name: string; icon: string } {
  return PROVIDER_CONFIG[providerId] ?? { name: providerId, icon: "❓" };
}

export function getAccountProviderId(account: any): string {
  return account?.providerId ?? (account?.accountId ? "siwn" : "unknown");
}
