import type { TestPlugin } from "./fixtures/test-plugin/src/index";
import { TEST_PLUGIN_MANIFEST_URL } from "./setup/global-setup";

export type TestRegistry = {
  "test-plugin": typeof TestPlugin;
};

export const TEST_REGISTRY = {
  "test-plugin": {
    remote: TEST_PLUGIN_MANIFEST_URL,
    description: "Real test plugin for background producer integration testing",
  },
} as const;
