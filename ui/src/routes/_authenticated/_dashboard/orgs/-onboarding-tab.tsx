import { ArrowRightIcon, QrCodeIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import type { ApiClient } from "@/app";
import {
  Badge,
  Button,
  Card,
  CardContent,
  ConfirmDialog,
  EmptyState,
  SectionHeader,
  TabsContent,
} from "@/components";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import { formatRemaining, onboardingCodeState } from "@/lib/onboarding-codes";

type OnboardingCodeSummary = Awaited<ReturnType<ApiClient["auth"]["listOnboardingCodes"]>>[number];
type OnboardingStatus = Awaited<ReturnType<ApiClient["auth"]["getOnboardingStatus"]>>;

const orgOnboardingQueryKey = (orgId: string) => ["org-onboarding", orgId] as const;
const orgOnboardingStatusQueryKey = (codeId: string) => ["org-onboarding-status", codeId] as const;

const STATE_BADGE = {
  active: "success",
  expired: "outline",
  revoked: "outline",
  "used-up": "secondary",
} as const;

function stateLabel(code: OnboardingCodeSummary): string {
  const state = onboardingCodeState(code);
  if (state === "used-up") return "used up";
  if (state === "active") return `${code.usedCount}/${code.maxUses} joined`;
  return state;
}

export function OnboardingTab({
  apiClient,
  canManage,
  orgId,
}: {
  apiClient: ApiClient;
  canManage: boolean;
  orgId: string;
}) {
  const queryClient = useQueryClient();
  const location = useLocation();
  const [selectedCodeId, setSelectedCodeId] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const codes =
    useQuery({
      queryKey: orgOnboardingQueryKey(orgId),
      queryFn: async (): Promise<OnboardingCodeSummary[]> => {
        return apiClient.auth.listOnboardingCodes({ organizationId: orgId });
      },
      enabled: !!orgId && canManage,
      refetchInterval: 10_000,
    }).data ?? [];

  const status = useQuery({
    queryKey: orgOnboardingStatusQueryKey(selectedCodeId ?? ""),
    queryFn: async (): Promise<OnboardingStatus> => {
      return apiClient.auth.getOnboardingStatus({
        codeId: selectedCodeId!,
        organizationId: orgId,
      });
    },
    enabled: !!selectedCodeId && canManage,
    refetchInterval: 2_000,
  }).data;

  const revokeMutation = useMutation({
    mutationFn: async (codeId: string) => {
      return apiClient.auth.revokeOnboardingCode({ codeId, organizationId: orgId });
    },
    onSuccess: () => {
      toast.success("Onboarding code revoked");
      void queryClient.invalidateQueries({ queryKey: orgOnboardingQueryKey(orgId) });
    },
    onError: (error) => {
      toast.error(error.message || "Failed to revoke");
    },
  });

  const selectedCode = codes.find((code) => code.id === selectedCodeId) ?? null;
  const activeStatus = status && selectedCode ? status : null;

  if (!canManage) {
    return (
      <TabsContent value="onboard" className="pt-6">
        <EmptyState
          icon={QrCodeIcon}
          title="Only organizers run onboarding"
          description="Owners, admins and members of a team with the Events area."
        />
      </TabsContent>
    );
  }

  return (
    <TabsContent value="onboard" className="flex flex-col gap-6 pt-6">
      <SectionHeader
        title="Onboarding stations"
        description={
          <span data-testid="onboard.start-from-event">
            Start one from an event in My community; people who scan it join.
          </span>
        }
        action={
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link to="/dashboard/node" />}
            data-testid="onboard.open-my-community"
          >
            Open My community
            <ArrowRightIcon />
          </Button>
        }
      />

      {activeStatus && selectedCode && (
        <Card data-testid="onboard.status">
          <CardContent className="flex flex-col gap-5 p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex min-w-0 flex-col gap-1">
                <h3 className="text-lg font-medium text-foreground">{selectedCode.eventName}</h3>
                <span className="text-sm text-muted-foreground">
                  {formatRemaining(activeStatus.expiresAt)} left
                </span>
              </div>
              <div className="flex flex-col items-end" data-testid="onboard.joined-count">
                <span className="text-4xl font-semibold text-foreground tabular-nums">
                  {activeStatus.usedCount}
                  <span className="text-xl text-muted-foreground">/{activeStatus.maxUses}</span>
                </span>
                <span className="text-sm text-muted-foreground">joined</span>
              </div>
            </div>
            {activeStatus.joined.length > 0 ? (
              <ul
                className="flex flex-col divide-y divide-border"
                data-testid="onboard.joined-list"
              >
                {activeStatus.joined.map((entry) => (
                  <li key={entry.userId} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="min-w-0 truncate text-sm text-foreground">
                      {entry.userName ?? "New member"}
                    </span>
                    <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                      {entry.accountId ?? ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Waiting for the first scan…</p>
            )}
            {onboardingCodeState(selectedCode) === "active" && (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  nativeButton={false}
                  render={
                    <Link
                      to="/onboarding/station/$codeId"
                      params={{ codeId: selectedCode.id }}
                      search={{ org: orgId, from: location.href }}
                    />
                  }
                >
                  Open station
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setRevoking(selectedCode.id)}
                  disabled={revokeMutation.isPending}
                  data-testid="onboard.revoke-button"
                >
                  Revoke
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {codes.length > 0 ? (
        <ItemGroup>
          {codes.map((code, index) => {
            const state = onboardingCodeState(code);
            return (
              <div key={code.id} className="flex flex-col">
                {index > 0 && <ItemSeparator />}
                <Item size="sm">
                  <ItemMedia variant="icon">
                    <QrCodeIcon />
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle className="max-w-full">
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="min-w-0 max-w-full justify-start"
                        onClick={() => setSelectedCodeId(code.id)}
                        data-testid={`onboard.code-${code.id}`}
                      >
                        <span className="min-w-0 truncate">{code.eventName}</span>
                      </Button>
                    </ItemTitle>
                  </ItemContent>
                  <ItemActions>
                    <Badge
                      variant={STATE_BADGE[state]}
                      data-testid={`onboard.code-state-${code.id}`}
                    >
                      {stateLabel(code)}
                    </Badge>
                    {state === "active" && (
                      <Button
                        variant="outline"
                        size="sm"
                        nativeButton={false}
                        render={
                          <Link
                            to="/onboarding/station/$codeId"
                            params={{ codeId: code.id }}
                            search={{ org: orgId, from: location.href }}
                            data-testid={`onboard.open-station-${code.id}`}
                          />
                        }
                      >
                        Open station
                      </Button>
                    )}
                  </ItemActions>
                </Item>
              </div>
            );
          })}
        </ItemGroup>
      ) : (
        <EmptyState
          icon={QrCodeIcon}
          title="No stations yet"
          description="Stations you start from events show up here."
          className="py-10"
        />
      )}

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title="Revoke this station?"
        description="Its QR code stops working. People who already joined stay."
        confirmLabel="Revoke"
        variant="destructive"
        isPending={revokeMutation.isPending}
        onConfirm={() => {
          if (revoking) revokeMutation.mutate(revoking);
          setRevoking(null);
        }}
      />
    </TabsContent>
  );
}
