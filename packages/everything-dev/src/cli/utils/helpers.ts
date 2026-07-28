import { readFileSync } from "node:fs";
import { resolveExtendsRef } from "../../merge";

export function getExtendsRef(config: Record<string, unknown>): string | undefined {
  if (typeof config.extends === "string") {
    return config.extends;
  }

  if (config.extends && typeof config.extends === "object") {
    return resolveExtendsRef(config.extends as Record<string, string>, "production");
  }

  return undefined;
}

export function parseBosRef(ref: string): { account: string; gateway: string } | null {
  const match = ref.match(/^bos:\/\/([^/]+)\/(.+)$/);
  if (!match?.[1] || !match[2]) return null;
  return { account: match[1], gateway: match[2] };
}

export function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}
