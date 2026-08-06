import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import type { TransactionBuilder } from "near-kit";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { sessionQueryOptions, useApiClient, useAuthClient } from "@/app";
import { Badge, Button, Field, FieldLabel, Input, Textarea } from "@/components";
import { highlightJson } from "@/lib/json-highlight";

type RegistryAppDetail = {
  accountId: string;
  gatewayId: string;
  canonicalKey: string;
  canonicalConfigUrl: string;
  startCommand: string;
  domain: string | null;
  openUrl: string | null;
  hostUrl: string | null;
  uiUrl: string | null;
  uiSsrUrl: string | null;
  apiUrl: string | null;
  extends: string | null;
  parent: string | null;
  root: string | null;
  depth: number;
  status: "ready" | "invalid";
  metadata: {
    claimedBy: string | null;
    title: string | null;
    description: string | null;
    repoUrl: string | null;
    homepageUrl: string | null;
    imageUrl: string | null;
    updatedAt: string | null;
  } | null;
  metadataKey: string;
  metadataContractId: string;
  metadataFastKvUrl: string;
  extendsChain: string[];
  resolvedConfig: Record<string, unknown>;
};

type RegistryStatus = {
  discoveredApps: number;
  metadataContractId: string;
  metadataFastKvUrl: string;
  relayEnabled: boolean;
  relayAccountId: string | null;
  timestamp: string;
};

interface AppDetailContentProps {
  accountId: string;
  gatewayId: string;
  app: RegistryAppDetail;
  statusQuery: { data?: RegistryStatus };
}

const BASE_RUNTIME = "bos://dev.everything.near/everything.dev";

export function AppDetailContent({
  accountId,
  gatewayId,
  app,
  statusQuery,
}: AppDetailContentProps) {
  const queryClient = useQueryClient();
  const apiClient = useApiClient();
  const auth = useAuthClient();

  const { data: session } = useQuery(sessionQueryOptions(auth, undefined));
  const nearAccountId = auth.near.getAccountId();
  const user = session?.user;

  const [title, setTitle] = useState(app?.metadata?.title ?? "");
  const [description, setDescription] = useState(app?.metadata?.description ?? "");
  const [repoUrl, setRepoUrl] = useState(app?.metadata?.repoUrl ?? "");
  const [homepageUrl, setHomepageUrl] = useState(app?.metadata?.homepageUrl ?? app?.openUrl ?? "");
  const [imageUrl, setImageUrl] = useState(app?.metadata?.imageUrl ?? "");
  const [delegatePayload, setDelegatePayload] = useState<string | null>(null);
  const [copiedUri, setCopiedUri] = useState(false);

  const isTenant = app.extends === BASE_RUNTIME;
  const bosUri = `bos://${accountId}/${gatewayId}`;
  const displayTitle = app.metadata?.title ?? `${accountId} / ${gatewayId}`;
  const startCommand = `bunx everything-dev@latest start --account ${accountId} --domain ${gatewayId}`;
  const extendCommand = `bunx everything-dev@latest init --extends bos://${accountId}/${gatewayId}`;

  const configQuery = useQuery({
    queryKey: ["fastkv-config", app.canonicalConfigUrl],
    queryFn: async () => {
      const res = await fetch(app.canonicalConfigUrl);
      if (!res.ok) throw new Error(`Failed to fetch config: ${res.status}`);
      return res.json() as Promise<Record<string, unknown>>;
    },
    staleTime: 60_000,
    enabled: Boolean(app.canonicalConfigUrl),
  });

  const refreshQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["app", accountId, gatewayId] }),
      queryClient.invalidateQueries({ queryKey: ["apps-account", accountId] }),
      queryClient.invalidateQueries({ queryKey: ["apps"] }),
    ]);
  };

  const prepareMetadataMutation = useMutation({
    mutationFn: async () => {
      if (!nearAccountId) throw new Error("Connect a NEAR wallet to publish metadata.");
      return apiClient.apps.prepareRegistryMetadataWrite({
        accountId,
        gatewayId,
        claimedBy: nearAccountId,
        title: title.trim() || undefined,
        description: description.trim() || undefined,
        repoUrl: repoUrl.trim() || undefined,
        homepageUrl: homepageUrl.trim() || undefined,
        imageUrl: imageUrl.trim() || undefined,
      });
    },
  });

  const publishMutation = useMutation({
    mutationFn: async () => {
      const prepared = await prepareMetadataMutation.mutateAsync();
      const signed = await auth.near.buildSignedDelegateAction(
        prepared.data.contractId,
        (builder: TransactionBuilder) =>
          builder.functionCall(
            prepared.data.contractId,
            prepared.data.methodName,
            prepared.data.args,
            { gas: "10000000000000", attachedDeposit: 0n },
          ),
      );
      const result = await auth.near.relayTransaction({ payload: signed });
      if (result.error) throw new Error(result.error.message || "Relay failed");
      return result.data;
    },
    onSuccess: async (result) => {
      setDelegatePayload(null);
      toast.success("Metadata submitted", {
        description: result?.txHash ? `tx: ${result.txHash}` : "Indexing may take a moment.",
      });
      await refreshQueries();
    },
    onError: (err: Error) => toast.error(err.message || "Failed to publish"),
  });

  const signDelegateMutation = useMutation({
    mutationFn: async () => {
      const prepared = await prepareMetadataMutation.mutateAsync();
      return auth.near.buildSignedDelegateAction(
        prepared.data.contractId,
        (builder: TransactionBuilder) =>
          builder.functionCall(
            prepared.data.contractId,
            prepared.data.methodName,
            prepared.data.args,
            { gas: "10000000000000", attachedDeposit: 0n },
          ),
      );
    },
    onSuccess: (payload: string) => {
      setDelegatePayload(payload);
      toast.success("Payload signed — relay below or copy to submit elsewhere.");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to sign"),
  });

  const relayMutation = useMutation({
    mutationFn: async () => {
      if (!delegatePayload) throw new Error("Sign a payload first.");
      const result = await auth.near.relayTransaction({ payload: delegatePayload });
      if (result.error) throw new Error(result.error.message || "Relay failed");
      return result.data;
    },
    onSuccess: async (result) => {
      toast.success("Relayed", {
        description: result?.txHash ? `tx: ${result.txHash}` : undefined,
      });
      await refreshQueries();
    },
    onError: (err: Error) => toast.error(err.message || "Relay failed"),
  });

  const isAnyPending =
    publishMutation.isPending || signDelegateMutation.isPending || relayMutation.isPending;

  return (
    <div className="space-y-6 min-w-0">
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`inline-block w-2 h-2 rounded-full shrink-0 ${
              app.status === "ready" ? "bg-green-500" : "bg-destructive"
            }`}
          />
          {isTenant && (
            <Badge variant="outline" className="text-xs">
              tenant
            </Badge>
          )}
          {app.metadata?.claimedBy ? (
            <Badge variant="secondary" className="text-xs">
              claimed by {app.metadata.claimedBy}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs text-muted-foreground">
              unclaimed
            </Badge>
          )}
        </div>

        <h1 className="text-xl font-bold text-foreground break-all">{displayTitle}</h1>

        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(bosUri);
            setCopiedUri(true);
            toast.success("Copied bos:// address");
            setTimeout(() => setCopiedUri(false), 2000);
          }}
          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors group cursor-pointer"
        >
          <code className="font-mono text-xs">{bosUri}</code>
          {copiedUri ? (
            <Check size={11} className="shrink-0 text-green-500" />
          ) : (
            <Copy size={11} className="shrink-0 transition-opacity" />
          )}
        </button>

        {app.metadata?.description && (
          <p className="text-sm text-muted-foreground leading-relaxed">
            {app.metadata.description}
          </p>
        )}

        <div className="flex gap-3 flex-wrap">
          {app.metadata?.repoUrl && (
            <a
              href={app.metadata.repoUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-muted-foreground hover:text-foreground underline transition-colors"
            >
              repository
            </a>
          )}
          {app.metadata?.homepageUrl && (
            <a
              href={app.metadata.homepageUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-muted-foreground hover:text-foreground underline transition-colors"
            >
              homepage
            </a>
          )}
          <a
            href={app.canonicalConfigUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground underline transition-colors"
          >
            FastKV config
          </a>
        </div>
      </div>

      <section className="space-y-2">
        <SectionLabel>Runtime</SectionLabel>
        <div className="space-y-1.5">
          <RuntimeRow label="host" value={app.hostUrl} />
          <RuntimeRow label="ui" value={app.uiUrl} />
          <RuntimeRow label="api" value={app.apiUrl} />
          {app.uiSsrUrl && <RuntimeRow label="ssr" value={app.uiSsrUrl} />}
          {app.extends && <RuntimeRow label="extends" value={app.extends} isUrl={false} mono />}
          {isTenant && (
            <div className="rounded-lg border border-border bg-muted/30 px-3.5 py-3 space-y-1">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Tenant runtime — the shared host serves a custom UI at{" "}
                {app.domain ? (
                  <a
                    href={`https://${app.domain}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-foreground hover:underline"
                  >
                    {app.domain}
                  </a>
                ) : (
                  <span className="font-mono">{accountId}.everything.dev</span>
                )}{" "}
                while keeping the base auth, API, and plugins intact.
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="space-y-2">
        <SectionLabel>Start command</SectionLabel>
        <StartCommand command={startCommand} />
      </section>

      <section className="space-y-2">
        <SectionLabel>Extend command</SectionLabel>
        <StartCommand command={extendCommand} />
      </section>

      {app.canonicalConfigUrl && (
        <section className="space-y-2">
          <SectionLabel>FastKV config</SectionLabel>
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="bg-muted/30 px-3.5 py-2 border-b border-border flex items-center justify-between">
              <a
                href={app.canonicalConfigUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] font-mono text-muted-foreground hover:text-foreground transition-colors underline"
              >
                {app.canonicalKey}
              </a>
              {configQuery.data && (
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(JSON.stringify(configQuery.data, null, 2));
                    toast.success("Config copied");
                  }}
                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  copy
                </button>
              )}
            </div>
            <div className="p-0">
              {configQuery.isLoading ? (
                <div className="p-6 text-center text-xs text-muted-foreground">Loading...</div>
              ) : configQuery.error ? (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  Failed to load config.{" "}
                  <button
                    type="button"
                    onClick={() => configQuery.refetch()}
                    className="text-foreground hover:underline"
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <pre className="overflow-x-auto p-4 font-mono text-sm text-foreground leading-relaxed whitespace-pre bg-foreground text-background">
                  {highlightJson(JSON.stringify(configQuery.data, null, 2))}
                </pre>
              )}
            </div>
          </div>
        </section>
      )}

      <section className="space-y-3">
        <SectionLabel>Claim / Edit Metadata</SectionLabel>
        {!user ? (
          <p className="text-sm text-muted-foreground">
            Sign in and link a NEAR wallet to publish metadata for this app.
          </p>
        ) : !nearAccountId ? (
          <p className="text-sm text-muted-foreground">
            No NEAR wallet linked. Open settings to connect one.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="meta-title">Title</FieldLabel>
                <Input
                  id="meta-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="App title"
                  className="h-9 text-sm"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="meta-repo">Repo URL</FieldLabel>
                <Input
                  id="meta-repo"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="https://github.com/..."
                  className="h-9 text-sm"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="meta-homepage">Homepage URL</FieldLabel>
                <Input
                  id="meta-homepage"
                  value={homepageUrl}
                  onChange={(e) => setHomepageUrl(e.target.value)}
                  placeholder="https://..."
                  className="h-9 text-sm"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="meta-image">Image URL</FieldLabel>
                <Input
                  id="meta-image"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="https://..."
                  className="h-9 text-sm"
                />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="meta-desc">Description</FieldLabel>
              <Textarea
                id="meta-desc"
                value={description}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  setDescription(e.target.value)
                }
                rows={3}
                placeholder="Short description"
                className="text-sm"
              />
            </Field>

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => publishMutation.mutate()} disabled={isAnyPending} size="sm">
                {publishMutation.isPending ? "Publishing..." : "Publish now"}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => signDelegateMutation.mutate()}
                disabled={isAnyPending}
              >
                {signDelegateMutation.isPending ? "Signing..." : "Sign delegate"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => relayMutation.mutate()}
                disabled={!statusQuery.data?.relayEnabled || !delegatePayload || isAnyPending}
              >
                {relayMutation.isPending ? "Relaying..." : "Relay payload"}
              </Button>
            </div>

            {delegatePayload && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
                    Signed delegate payload
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs gap-1"
                    onClick={async () => {
                      await navigator.clipboard.writeText(delegatePayload);
                      toast.success("Payload copied");
                    }}
                  >
                    <Copy size={10} />
                    copy
                  </Button>
                </div>
                <pre
                  className="overflow-x-auto rounded border border-border bg-muted/10 p-3 font-mono text-foreground whitespace-pre-wrap break-all"
                  style={{ fontSize: 10, lineHeight: "1.5", maxHeight: 140 }}
                >
                  {delegatePayload}
                </pre>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Direct publish uses <code className="font-mono">waitUntil: NONE</code>. The wallet may
              report failure while FastKV still indexes the transaction successfully.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function StartCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    toast.success("Copied");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="w-full group flex items-center justify-between gap-3 rounded-[8px] border border-border bg-foreground px-4 py-3 cursor-pointer transition-opacity duration-150 hover:opacity-90 text-left"
    >
      <code className="font-mono text-sm font-semibold text-background break-all leading-snug">
        {command}
      </code>
      <span
        className={`shrink-0 transition-colors duration-150 ${copied ? "text-brand-accent" : "text-background/50 group-hover:text-background/80"}`}
      >
        <Copy size={14} />
      </span>
    </button>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border pb-1">
      {children}
    </div>
  );
}

function RuntimeRow({
  label,
  value,
  isUrl = true,
  mono,
}: {
  label: string;
  value: string | null | undefined;
  isUrl?: boolean;
  mono?: boolean;
}) {
  if (!value) return null;
  const looksLikeUrl = isUrl && /^https?:\/\//.test(value);
  return (
    <div className="flex items-start gap-2 rounded border border-border bg-muted/10 px-2.5 py-1.5 text-xs">
      <span
        className="text-muted-foreground uppercase tracking-wide shrink-0 pt-px font-semibold min-w-[40px]"
        style={{ fontSize: 10 }}
      >
        {label}
      </span>
      {looksLikeUrl ? (
        <a
          href={value}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-foreground hover:underline break-all"
        >
          {value}
        </a>
      ) : (
        <span className={`text-foreground break-all ${mono ? "font-mono" : ""}`}>{value}</span>
      )}
    </div>
  );
}
