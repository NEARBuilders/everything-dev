import { resolveConfigComposableEntries } from "../../config";
import type { BosConfig } from "../../types";
import { BosConfigSchema } from "../../types";
import { walkExtendsChain } from "../resolution/session";

export async function resolvePublishedConfig(
  account: string,
  gateway: string,
  registry?: string,
): Promise<BosConfig | null> {
  try {
    const { config: merged } = await walkExtendsChain(`bos://${account}/${gateway}`, {
      env: "production",
      registry,
      visit: async () => {},
    });
    return resolveConfigComposableEntries(
      BosConfigSchema.parse(merged),
      process.cwd(),
      "production",
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("No config found")) {
      return null;
    }
    throw error;
  }
}
