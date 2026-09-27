import { ArrowLeftIcon } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { getDeviceLinkClientId, refreshSessionCache, useAuthClient } from "everything-dev/ui/auth";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { offerPasskeyOnThisDevice } from "@/lib/passkey-offer";

const DEVICE_LINK_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

type DeviceLink = {
  deviceCode: string;
  userCode: string;
  verificationUriComplete: string;
  intervalMs: number;
};

type TokenError = { error?: string; code?: string } | null;

export function PairPanel({ redirect, onClose }: { redirect: string; onClose: () => void }) {
  const auth = useAuthClient();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [link, setLink] = useState<DeviceLink | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [claimed, setClaimed] = useState(false);
  const canceledRef = useRef(false);

  useEffect(() => {
    canceledRef.current = false;
    let active = true;
    void auth.device
      .code({ client_id: getDeviceLinkClientId() })
      .then(({ data, error }: { data: Record<string, unknown> | null; error: unknown }) => {
        if (!active) return;
        if (error || !data) {
          setFailed("Could not start device pairing");
          return;
        }
        const record = data as {
          device_code: string;
          user_code: string;
          verification_uri: string;
          verification_uri_complete?: string;
          interval?: number;
        };
        const complete = record.verification_uri_complete ?? record.verification_uri;
        const uri = complete.startsWith("http") ? complete : `${window.location.origin}${complete}`;
        setLink({
          deviceCode: record.device_code,
          userCode: record.user_code,
          verificationUriComplete: uri,
          intervalMs: (record.interval ?? 5) * 1000,
        });
        void QRCode.toDataURL(uri, { width: 220, margin: 1 }).then((url) => {
          if (active) setQrDataUrl(url);
        });
      });
    return () => {
      active = false;
      canceledRef.current = true;
    };
  }, [auth]);

  useEffect(() => {
    if (!link || claimed || canceledRef.current) return;
    let timer: number | undefined;
    let intervalMs = link.intervalMs;
    const poll = async () => {
      if (canceledRef.current) return;
      const { data, error } = await auth.device.token({
        grant_type: DEVICE_LINK_GRANT_TYPE,
        device_code: link.deviceCode,
        client_id: getDeviceLinkClientId(),
      });
      if (canceledRef.current) return;
      const token = (data as { access_token?: string } | null)?.access_token;
      if (token) {
        setClaimed(true);
        const claim = await auth.$fetch("/device-link/claim", {
          method: "POST",
          body: { token, client_id: getDeviceLinkClientId() },
        });
        if (claim.error) {
          setFailed("Failed to complete sign-in");
          return;
        }
        await refreshSessionCache(auth, queryClient);
        toast.success("Signed in");
        await navigate({ href: redirect, replace: true });
        offerPasskeyOnThisDevice(auth);
        return;
      }
      const err = (error as TokenError)?.error;
      if (err === "expired_token") {
        setFailed("This code expired. Start again to get a new one.");
        return;
      }
      if (err === "access_denied") {
        setFailed("Sign-in was denied on your phone.");
        return;
      }
      if (err === "slow_down") {
        intervalMs += 5000;
      }
      timer = window.setTimeout(poll, intervalMs);
    };
    timer = window.setTimeout(poll, intervalMs);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [auth, link, claimed, navigate, queryClient, redirect]);

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="rounded-3xl border border-border bg-card p-4" data-testid="device.qr">
        {qrDataUrl ? (
          <img src={qrDataUrl} alt="Scan with your phone to sign in" className="size-56" />
        ) : (
          <Skeleton className="size-56" />
        )}
      </div>
      <div className="flex flex-col items-center gap-1">
        <span className="text-sm text-muted-foreground">Or enter this code on your phone</span>
        <span
          className="font-mono text-2xl font-semibold tracking-widest text-foreground"
          data-testid="device.user-code"
        >
          {link?.userCode ?? "········"}
        </span>
      </div>
      {failed ? (
        <p className="text-center text-sm text-destructive" data-testid="device.error">
          {failed}
        </p>
      ) : (
        <p
          className="flex items-center gap-2 text-sm text-muted-foreground"
          data-testid="device.status"
        >
          <Spinner />
          {claimed ? "Signing in…" : "Waiting for your phone…"}
        </p>
      )}
      <Button type="button" variant="ghost" onClick={onClose} data-testid="device.cancel-button">
        <ArrowLeftIcon data-icon="inline-start" />
        Other ways to sign in
      </Button>
    </div>
  );
}
