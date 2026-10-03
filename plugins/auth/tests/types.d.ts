import Plugin from "@/index";
import packageJson from "../package.json" with { type: "json" };

declare module "every-plugin" {
  interface RegisteredPlugins {
    [packageJson.name]: typeof Plugin;
  }
}
