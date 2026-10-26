import { resolveConfigComposableEntries } from "../../config";
import type { BosConfig } from "../../types";
import { BosConfigSchema } from "../../types";
import { PUBLISHED_CONFIG_ENV } from "../resolution/load";
import { walkExtendsChain } from "../resolution/session";

export async function resolvePublishedConfig(
  account: string,
  gateway: string,
  registry?: string,
): Promise<BosConfig | null> {
  try {
    const { config: merged } = await walkExtendsChain(`bos://${account}/${gateway}`, {
      env: PUBLISHED_CONFIG_ENV,
      registry,
      visit: async () => {},
    });
    return resolveConfigComposableEntries(
      BosConfigSchema.parse(merged),
      process.cwd(),
      PUBLISHED_CONFIG_ENV,
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("No config found")) {
      return null;
    }
    throw error;
  }
}
