import { QrCodeIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import QRCode from "qrcode";
import { type CSSProperties, useEffect, useState } from "react";
import type { ApiClient } from "@/app";
import { Avatar, AvatarFallback, LocalDate } from "@/components";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { onboardingUrl } from "@/lib/gateway-origin";
import { formatRemaining } from "@/lib/onboarding-codes";

const RECENT_JOINERS = 6;

function initials(name: string | null | undefined) {
  if (!name) return "·";
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "·"
  );
}

export function OnboardingStation({
  apiClient,
  codeId,
  organizationId,
  gatewayOrigin,
}: {
  apiClient: ApiClient;
  codeId: string;
  organizationId?: string;
  gatewayOrigin: string;
}) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const station = useQuery({
    queryKey: ["onboarding-station", codeId, organizationId],
    queryFn: () => apiClient.auth.getOnboardingStation({ codeId, organizationId }),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const status = useQuery({
    queryKey: ["onboarding-station-status", codeId, organizationId],
    queryFn: () => apiClient.auth.getOnboardingStatus({ codeId, organizationId }),
    enabled: station.isSuccess,
    refetchInterval: 2_000,
  });

  const code = station.data?.code;
  useEffect(() => {
    if (!code) return;
    let active = true;
    void QRCode.toDataURL(onboardingUrl(gatewayOrigin, code), { width: 960, margin: 2 }).then(
      (dataUrl) => {
        if (active) setQrDataUrl(dataUrl);
      },
    );
    return () => {
      active = false;
    };
  }, [code, gatewayOrigin]);

  if (station.isError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-12 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <WarningCircleIcon size={28} />
        </div>
        <h1 className="text-2xl font-semibold text-foreground">Station unavailable</h1>
        <p className="max-w-md text-lg text-muted-foreground" data-testid="station.unavailable">
          {station.error.message || "This onboarding station is unavailable."}
        </p>
      </div>
    );
  }

  if (!station.data) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <p
          className="flex items-center gap-2 text-sm text-muted-foreground"
          data-testid="station.loading"
        >
          <Spinner />
          Opening station…
        </p>
      </div>
    );
  }

  const usedCount = status.data?.usedCount ?? station.data.usedCount;
  const maxUses = station.data.maxUses;
  const joiners = (status.data?.joined ?? []).slice(0, RECENT_JOINERS);
  const gatewayHost = new URL(gatewayOrigin).host;
  const filled = maxUses > 0 ? Math.min(100, Math.round((usedCount / maxUses) * 100)) : 0;

  return (
    <div className="flex flex-1 flex-col items-center gap-10 px-4 pb-10 sm:px-6 lg:flex-row lg:items-center lg:justify-center lg:gap-20 lg:px-12">
      <div className="flex w-full max-w-xl flex-col items-center gap-4">
        <div className="w-full rounded-4xl bg-card p-4 ring-1 ring-border sm:p-6">
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt={`Scan to join ${station.data.eventName}`}
              className="aspect-square w-full rounded-2xl"
              data-testid="station.qr"
            />
          ) : (
            <Skeleton className="aspect-square w-full" />
          )}
        </div>
        <p className="text-center text-base text-muted-foreground sm:text-lg">
          <QrCodeIcon className="mr-2 inline size-5 align-text-bottom" />
          Scan with your phone camera, or open{" "}
          <span className="font-mono break-all text-foreground">{gatewayHost}/onboard</span>
        </p>
      </div>

      <div className="flex w-full max-w-lg flex-col gap-10">
        <div className="flex flex-col gap-3">
          <span className="text-lg font-medium text-muted-foreground">Scan to join</span>
          <h1
            className="text-4xl font-semibold wrap-anywhere text-foreground sm:text-6xl"
            data-testid="station.event-name"
          >
            {station.data.eventName}
          </h1>
        </div>

        <div className="flex flex-col gap-4">
          <p className="flex items-baseline gap-3" data-testid="station.joined-count">
            <span className="text-7xl font-semibold tabular-nums text-foreground sm:text-8xl">
              {usedCount}
            </span>{" "}
            <span className="text-2xl text-muted-foreground">joined</span>
          </p>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full w-(--station-fill) rounded-full bg-brand"
              style={{ "--station-fill": `${filled}%` } as CSSProperties}
            />
          </div>
          <p className="text-sm text-muted-foreground" data-testid="station.capacity">
            {maxUses - usedCount > 0 ? `${maxUses - usedCount} spots left` : "Full"} ·{" "}
            {formatRemaining(station.data.expiresAt)} left
          </p>
        </div>

        <div className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold text-foreground">Just joined</h2>
          {joiners.length > 0 ? (
            <ul className="flex flex-col gap-3" data-testid="station.recent-joiners">
              {joiners.map((entry) => (
                <li key={entry.userId} className="flex items-center gap-4">
                  <Avatar size="lg">
                    <AvatarFallback>{initials(entry.userName)}</AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1 truncate text-xl text-foreground">
                    {entry.userName ?? "New member"}
                  </span>
                  <span className="shrink-0 text-sm text-muted-foreground">
                    <LocalDate value={entry.createdAt} format="relative" />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-3 text-lg text-muted-foreground">
              <span className="size-2.5 animate-pulse rounded-full bg-brand" />
              Waiting for the first scan…
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
