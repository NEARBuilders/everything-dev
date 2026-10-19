export function getNetworkIdForAccount(account: string): "mainnet" | "testnet" {
  return account.endsWith(".testnet") ? "testnet" : "mainnet";
}
