import { ArrowLeftIcon, ArrowsInIcon, ArrowsOutIcon } from "@phosphor-icons/react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getActiveRuntime, useApiClient } from "@/app";
import { Button } from "@/components";
import { useClientValue } from "@/hooks";
import { getGatewayOrigin } from "@/lib/gateway-origin";
import { returnPath } from "@/lib/return-path";
import { OnboardingStation } from "./-onboarding-station";

type StationSearch = { org?: string; from?: string };

export const Route = createFileRoute("/_authenticated/onboarding/station/$codeId")({
  validateSearch: (search: Record<string, unknown>): StationSearch => ({
    org: typeof search.org === "string" && search.org ? search.org : undefined,
    from: returnPath(search.from),
  }),
  head: () => ({ meta: [{ title: "Onboarding station" }] }),
  component: OnboardingStationPage,
});

function OnboardingStationPage() {
  const { codeId } = Route.useParams();
  const { org, from } = Route.useSearch();
  const navigate = useNavigate();
  const { runtimeConfig } = Route.useRouteContext();
  const apiClient = useApiClient();
  const gatewayOrigin = useClientValue<string | null>(
    () => getGatewayOrigin(getActiveRuntime(runtimeConfig)?.gatewayId),
    null,
  );

  const [fullscreen, setFullscreen] = useState(false);
  const canFullscreen = useClientValue(() => document.fullscreenEnabled === true, false);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => {});
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void navigate({ href: from ?? "/dashboard" })}
          data-testid="station.exit"
        >
          <ArrowLeftIcon data-icon="inline-start" />
          Exit station
        </Button>
        {canFullscreen && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={toggleFullscreen}
            data-testid="station.fullscreen"
          >
            {fullscreen ? (
              <ArrowsInIcon data-icon="inline-start" />
            ) : (
              <ArrowsOutIcon data-icon="inline-start" />
            )}
            {fullscreen ? "Exit full screen" : "Full screen"}
          </Button>
        )}
      </header>
      {gatewayOrigin && (
        <OnboardingStation
          apiClient={apiClient}
          codeId={codeId}
          organizationId={org}
          gatewayOrigin={gatewayOrigin}
        />
      )}
    </div>
  );
}
