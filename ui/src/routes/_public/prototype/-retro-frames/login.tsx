import {
  CheckCircleIcon,
  CircleNotchIcon,
  FingerprintIcon,
  KeyIcon,
  QrCodeIcon,
  WalletIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import {
  RetroButton,
  RetroInput,
  RetroLabel,
  RetroRule,
  RetroWindow,
} from "@/components/ui/retro-prototype";

type LoginState = "idle" | "waiting" | "done";

export function LoginScreen() {
  const [state, setState] = useState<LoginState>("idle");

  const start = () => {
    if (state !== "idle") {
      setState("idle");
      return;
    }
    setState("waiting");
    setTimeout(() => setState("done"), 1400);
  };

  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-background px-4 pt-16 pb-28"
      data-testid="proto-login"
    >
      <RetroWindow className="w-full max-w-md" title="Sign in" icon={<KeyIcon />}>
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold text-foreground">everything.dev</h1>
          <p className="text-base text-muted-foreground">
            Sign in, or create an account in one step.
          </p>
        </div>

        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            start();
          }}
        >
          <RetroLabel htmlFor="proto-login-account">Account</RetroLabel>
          <RetroInput
            id="proto-login-account"
            name="username"
            autoComplete="username webauthn"
            placeholder="Choose a passkey, or type a name"
          />
          <RetroButton
            type="submit"
            size="xl"
            className="mt-2 w-full"
            pressed={state === "waiting"}
            aria-busy={state === "waiting"}
            data-testid="login-continue"
          >
            {state === "idle" && (
              <>
                <FingerprintIcon />
                Continue
              </>
            )}
            {state === "waiting" && (
              <>
                <CircleNotchIcon className="animate-spin" />
                Waiting for passkey
              </>
            )}
            {state === "done" && (
              <>
                <CheckCircleIcon />
                Signed in as alice.near
              </>
            )}
          </RetroButton>
          <p className="text-sm text-muted-foreground">
            Uses a passkey on this device. New here? You will create one.
          </p>
        </form>

        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <RetroRule />
          or
          <RetroRule />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <RetroButton variant="outline" size="lg" className="w-full">
            <WalletIcon />
            NEAR wallet
          </RetroButton>
          <RetroButton variant="outline" size="lg" className="w-full">
            <QrCodeIcon />
            Use your phone
          </RetroButton>
        </div>
      </RetroWindow>
      <a href="/" className="text-sm text-muted-foreground hover:text-foreground">
        Back to everything.dev
      </a>
    </div>
  );
}
