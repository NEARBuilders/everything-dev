import type { AuthClient } from "everything-dev/ui/auth";
import { toast } from "sonner";

const PASSKEY_OFFER_DISMISSED_KEY = "device-link.passkey-offer-dismissed";

function isPasskeyOfferDismissed() {
  try {
    return window.localStorage.getItem(PASSKEY_OFFER_DISMISSED_KEY) === "true";
  } catch {
    return false;
  }
}

function rememberPasskeyOfferDismissed() {
  try {
    window.localStorage.setItem(PASSKEY_OFFER_DISMISSED_KEY, "true");
  } catch {}
}

async function addPasskeyOnThisDevice(auth: AuthClient) {
  const { error } = await auth.passkey.addPasskey();
  if (error) {
    toast.error(error.message || "Could not add a passkey");
    return;
  }
  rememberPasskeyOfferDismissed();
  toast.success("Passkey added");
}

export function offerPasskeyOnThisDevice(auth: AuthClient) {
  if (isPasskeyOfferDismissed()) return;
  toast("Add a passkey on this device", {
    id: "device-link.passkey-offer",
    testId: "device-link.passkey-offer",
    description: "Next time you can sign in here without your phone.",
    duration: Number.POSITIVE_INFINITY,
    action: {
      label: "Add passkey",
      onClick: () => void addPasskeyOnThisDevice(auth),
    },
    cancel: {
      label: "Not now",
      onClick: rememberPasskeyOfferDismissed,
    },
    onDismiss: rememberPasskeyOfferDismissed,
  });
}
