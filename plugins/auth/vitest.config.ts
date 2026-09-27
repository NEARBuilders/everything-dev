import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "backend",
          include: ["tests/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        resolve: {
          alias: {
            "@": path.resolve(import.meta.dirname, "ui/src"),
          },
        },
        test: {
          name: "ui",
          include: ["ui/src/**/*.test.ts", "ui/src/**/*.test.tsx"],
          environment: "jsdom",
          exclude: ["node_modules/**", "dist/**"],
        },
      },
    ],
  },
});
