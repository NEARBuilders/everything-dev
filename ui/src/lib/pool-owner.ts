import { Near } from "near-kit";

const cache = new Map<string, string | null>();

export async function fetchPoolOwner(
  poolAccountId: string,
  network: string,
): Promise<string | null> {
  const key = `${network}:${poolAccountId}`;
  if (cache.has(key)) return cache.get(key) ?? null;

  try {
    const near = new Near({ network: network === "testnet" ? "testnet" : "mainnet" });
    const owner = await near.view<string>(poolAccountId, "owner_id", {});
    const result = typeof owner === "string" && owner.length > 0 ? owner : null;
    cache.set(key, result);
    return result;
  } catch {
    cache.set(key, null);
    return null;
  }
}
