import { Context } from "effect";
import type { AuthServices } from "./auth-export";
import type { Auth as ConfiguredAuth } from "./auth-instance";
import type { Database } from "./db";
import type { OnboardingCodeCipher } from "./onboarding-code-cipher";

export type PluginServices = Omit<AuthServices, "auth" | "db"> & {
  auth: ConfiguredAuth;
  db: Database;
  onboardingCodeCipher: OnboardingCodeCipher;
};

export class AuthServicesTag extends Context.Service<AuthServicesTag, PluginServices>()(
  "auth/AuthServices",
) {}
