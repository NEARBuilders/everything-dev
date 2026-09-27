import { ArrowLeftIcon, ClockIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import type { useApiClient } from "@/app";
import { Badge, Button, EmptyState, PageContainer, PageHeader } from "@/components";
import { ThingContent } from "./-thing-content";

type ApiClient = ReturnType<typeof useApiClient>;
type Thing = NonNullable<Awaited<ReturnType<ApiClient["template"]["getThing"]>>>;

export function ThingBackLink({ canGoBack, onBack }: { canGoBack: boolean; onBack: () => void }) {
  return canGoBack ? (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="-ml-3 self-start"
      onClick={onBack}
      data-testid="thing-back"
    >
      <ArrowLeftIcon />
      Things
    </Button>
  ) : (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-3 self-start"
      nativeButton={false}
      render={<Link to="/things" />}
      data-testid="thing-back"
    >
      <ArrowLeftIcon />
      Things
    </Button>
  );
}

export function ThingDetailsView({
  canGoBack,
  isAdmin,
  isDeletePending,
  thing,
  thingId,
  onBack,
  onDelete,
}: {
  canGoBack: boolean;
  isAdmin: boolean;
  isDeletePending: boolean;
  thing: Thing | undefined;
  thingId: string;
  onBack: () => void;
  onDelete: () => void;
}) {
  return (
    <PageContainer variant="default">
      <div className="flex flex-col gap-4">
        <ThingBackLink canGoBack={canGoBack} onBack={onBack} />
        <PageHeader
          title={<span className="block font-mono break-all">{thingId}</span>}
          headerTestId="thing.heading"
        />
        {thing && (
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="outline" className="font-mono">
              {thing.type}
            </Badge>
          </div>
        )}
      </div>

      {thing ? (
        <ThingContent
          thing={thing}
          isAdmin={isAdmin}
          isDeletePending={isDeletePending}
          onDelete={onDelete}
        />
      ) : (
        <EmptyState
          icon={ClockIcon}
          title="Not in the registry"
          description="This thing doesn't exist yet."
          action={
            <Button variant="outline" nativeButton={false} render={<Link to="/things/new" />}>
              Add another
            </Button>
          }
        />
      )}
    </PageContainer>
  );
}
