import { execFile } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { Effect } from "effect";
import { glob } from "glob";

const execFileAsync = promisify(execFile);

export const listFiles = (projectDir: string, pattern: string | string[]) =>
  Effect.tryPromise({
    try: async () =>
      glob(pattern, {
        cwd: projectDir,
        nodir: true,
        dot: false,
        absolute: false,
      }),
    catch: (error) => new Error(`glob failed for ${pattern}: ${String(error)}`),
  });

export const fileExists = (projectDir: string, relativePath: string) =>
  Effect.tryPromise({
    try: async () => {
      try {
        await stat(`${projectDir}/${relativePath}`);
        return true;
      } catch {
        return false;
      }
    },
    catch: (error) => new Error(`stat failed for ${relativePath}: ${String(error)}`),
  });

export const readText = (projectDir: string, relativePath: string) =>
  Effect.tryPromise({
    try: () => readFile(`${projectDir}/${relativePath}`, "utf-8"),
    catch: (error) => new Error(`read failed for ${relativePath}: ${String(error)}`),
  });

export const writeText = (projectDir: string, relativePath: string, content: string) =>
  Effect.tryPromise({
    try: async () => {
      const target = `${projectDir}/${relativePath}`;
      const dir = target.slice(0, target.lastIndexOf("/"));
      if (dir) await mkdir(dir, { recursive: true });
      await writeFile(target, content);
      return relativePath;
    },
    catch: (error) => new Error(`write failed for ${relativePath}: ${String(error)}`),
  });

export const removePath = (projectDir: string, relativePath: string) =>
  Effect.tryPromise({
    try: async () => {
      await rm(`${projectDir}/${relativePath}`, { force: true, recursive: true });
      return relativePath;
    },
    catch: (error) => new Error(`remove failed for ${relativePath}: ${String(error)}`),
  });

export const runCommand = (cwd: string, command: string, args: readonly string[]) =>
  Effect.tryPromise({
    try: async () => {
      const { stdout } = await execFileAsync(command, [...args], {
        cwd,
        maxBuffer: 16 * 1024 * 1024,
      });
      return stdout;
    },
    catch: (error) => new Error(`command failed: ${command} ${args.join(" ")}\n${String(error)}`),
  });
