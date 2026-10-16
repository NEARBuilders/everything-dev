import { readFileSync } from "node:fs";

export function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}
