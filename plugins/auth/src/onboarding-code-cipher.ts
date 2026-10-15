import { createSealedBox } from "./sealed-box";

const KEY_SALT = "citynode-onboarding-code";

export interface OnboardingCodeCipher {
  encrypt(code: string): Promise<string>;
  decrypt(sealed: string): Promise<string>;
}

export function createOnboardingCodeCipher(secret: string): OnboardingCodeCipher {
  const box = createSealedBox(KEY_SALT, secret);
  return {
    async encrypt(code) {
      return box.seal(code);
    },
    async decrypt(sealed) {
      return box.open(sealed);
    },
  };
}
