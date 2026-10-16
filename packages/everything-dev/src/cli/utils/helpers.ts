import { readFileSync } from "node:fs";

export { getExtendsRef, parseBosRef } from "../../utils/bos-ref";
export function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}
