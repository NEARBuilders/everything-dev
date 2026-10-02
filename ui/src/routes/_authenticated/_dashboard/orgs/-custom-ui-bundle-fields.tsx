import { type Dispatch, type SetStateAction, useState } from "react";
import { toast } from "sonner";
import {
  computeSsrEntryIntegrity,
  computeSubresourceIntegrity,
  computeUiEntryIntegrity,
  normalizeBundleBaseUrl,
  type TenantConfigDraft,
  useApiClient,
} from "@/app";
import { Button, FieldLabel, Input } from "@/components";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { ConfigField } from "./-config-field";

export interface CustomUiBundleFieldsProps {
  idPrefix: string;
  draft: TenantConfigDraft;
  setDraft: Dispatch<SetStateAction<TenantConfigDraft>>;
  allowSsr: boolean;
  disabled: boolean;
  gatewayId: string;
  collapsed?: boolean;
  onComputingChange?: (computing: boolean) => void;
}

export function CustomUiBundleFields({
  idPrefix,
  draft,
  setDraft,
  allowSsr,
  disabled,
  gatewayId,
  collapsed = false,
  onComputingChange,
}: CustomUiBundleFieldsProps) {
  const apiClient = useApiClient();
  const [computing, setComputingState] = useState(false);
  const [sourceAccount, setSourceAccount] = useState("");
  const [fetchingSource, setFetchingSource] = useState(false);

  const setComputing = (value: boolean) => {
    setComputingState(value);
    onComputingChange?.(value);
  };

  const onFillFromDeployedApp = async () => {
    const account = sourceAccount.trim();
    if (!account) {
      toast.error("Enter the NEAR account your app deployed under");
      return;
    }
    setFetchingSource(true);
    try {
      const result = await apiClient.registry.getRegistryApp({ accountId: account, gatewayId });
      const resolved = result.data?.resolvedConfig ?? null;
      const ui =
        (
          resolved?.app as {
            ui?: {
              production?: unknown;
              integrity?: unknown;
              pin?: { manifest?: unknown; integrity?: unknown };
            };
          } | null
        )?.ui ?? {};
      const production = typeof ui.production === "string" ? ui.production : "";
      const integrity = typeof ui.integrity === "string" ? ui.integrity : "";
      const pinManifest = typeof ui.pin?.manifest === "string" ? ui.pin.manifest : "";
      const pinIntegrity = typeof ui.pin?.integrity === "string" ? ui.pin.integrity : "";
      if (!production || (!integrity && !(pinManifest && pinIntegrity))) {
        toast.error(
          `${account} publishes no custom UI bundle yet — run \`bos deploy\` in the app repo with a local UI first.`,
        );
        return;
      }
      const ssr =
        (resolved?.app as { ui?: { ssr?: unknown; ssrIntegrity?: unknown } } | null)?.ui ?? {};
      const ssrUrl = typeof ssr.ssr === "string" ? ssr.ssr : "";
      const ssrIntegrity = typeof ssr.ssrIntegrity === "string" ? ssr.ssrIntegrity : "";
      setDraft((prev) => ({
        ...prev,
        uiProduction: production,
        uiIntegrity: pinManifest ? "" : integrity,
        uiManifest: pinManifest,
        uiPinIntegrity: pinIntegrity,
        ...(allowSsr && ssrUrl && ssrIntegrity ? { ssrUrl, ssrIntegrity } : {}),
      }));
      toast.success(`Bundle and integrity filled from ${account}`);
    } catch {
      toast.error(
        `No published config for ${account} on this gateway — run \`bos deploy\` in the app repo first.`,
      );
    } finally {
      setFetchingSource(false);
    }
  };

  const onVerifyBundle = async (
    url: string,
    currentIntegrity: string,
    compute: (url: string) => Promise<string>,
    apply: (computed: string) => void,
    label: string,
  ) => {
    setComputing(true);
    try {
      const computed = await compute(url);
      if (!currentIntegrity) {
        apply(computed);
        toast.success(`${label} integrity filled from the bundle`);
        return;
      }
      if (computed === currentIntegrity) {
        toast.success(`${label} integrity matches the bundle`);
      } else {
        toast.error(`${label} integrity mismatch — the bundle hashes to ${computed}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setComputing(false);
    }
  };

  const onVerifyUiBundle = () => {
    if (!draft.uiProduction) {
      toast.error("Enter the UI bundle URL first");
      return;
    }
    if (draft.uiManifest) {
      if (!draft.uiPinIntegrity) {
        toast.error("Enter the pin integrity first (or use Verify to fill it)");
      }
      return onVerifyBundle(
        draft.uiManifest,
        draft.uiPinIntegrity,
        (manifestName) =>
          computeSubresourceIntegrity(
            `${draft.uiProduction.replace(/\/$/, "")}/${manifestName.replace(/^\//, "")}`,
          ),
        (computed) => setDraft((prev) => ({ ...prev, uiPinIntegrity: computed })),
        "UI pin",
      );
    }
    return onVerifyBundle(
      draft.uiProduction,
      draft.uiIntegrity,
      computeUiEntryIntegrity,
      (computed) => setDraft((prev) => ({ ...prev, uiIntegrity: computed })),
      "UI",
    );
  };

  const onVerifySsrBundle = () => {
    if (!draft.ssrUrl) {
      toast.error("Enter the SSR bundle URL first");
      return;
    }
    return onVerifyBundle(
      draft.ssrUrl,
      draft.ssrIntegrity,
      computeSsrEntryIntegrity,
      (computed) => setDraft((prev) => ({ ...prev, ssrIntegrity: computed })),
      "SSR",
    );
  };

  if (collapsed) return null;

  return (
    <FieldGroup>
      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor={`${idPrefix}-source-account`}>Fill from a deployed app</FieldLabel>
        <div className="flex items-center gap-2">
          <Input
            id={`${idPrefix}-source-account`}
            type="text"
            value={sourceAccount}
            placeholder="<your-app>.near — the account that ran bos publish --deploy"
            onChange={(event) => setSourceAccount(event.target.value)}
            disabled={disabled}
            className="font-mono"
            data-testid={`${idPrefix}-source-account`}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => void onFillFromDeployedApp()}
            disabled={disabled || fetchingSource}
            data-testid={`${idPrefix}-autofill`}
          >
            {fetchingSource ? <Spinner /> : null}
            Fetch bundle
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Reads the published config of your deployed app and fills the bundle URL and integrity
          below.
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <ConfigField
          id={`${idPrefix}-ui-url`}
          label="UI bundle URL"
          value={draft.uiProduction}
          onChange={(value) => setDraft((prev) => ({ ...prev, uiProduction: value }))}
          onBlur={() =>
            setDraft((prev) => ({
              ...prev,
              uiProduction: normalizeBundleBaseUrl(prev.uiProduction),
            }))
          }
          placeholder="https://example.com/bundles/<account>/<gateway>/plugin/"
          mono
          disabled={disabled}
        />
        <Button
          type="button"
          onClick={() => void onVerifyUiBundle()}
          disabled={disabled || computing || !draft.uiProduction}
          variant="link"
          size="xs"
          className="self-start"
          data-testid={`${idPrefix}-verify`}
        >
          {computing ? "Hashing…" : "Verify and fill integrity"}
        </Button>
      </div>
      <ConfigField
        id={`${idPrefix}-ui-integrity`}
        label="UI integrity (direct entry hash)"
        value={draft.uiIntegrity}
        onChange={(value) =>
          setDraft((prev) => ({
            ...prev,
            uiIntegrity: value,
            ...(value ? { uiManifest: "", uiPinIntegrity: "" } : {}),
          }))
        }
        placeholder="sha384-…"
        mono
        disabled={disabled}
      />
      <ConfigField
        id={`${idPrefix}-ui-pin-manifest`}
        label="UI version-manifest pin"
        value={draft.uiManifest}
        onChange={(value) =>
          setDraft((prev) => ({
            ...prev,
            uiManifest: value,
            ...(value ? { uiIntegrity: "" } : {}),
          }))
        }
        onBlur={() =>
          setDraft((prev) => ({
            ...prev,
            uiManifest: prev.uiManifest.trim().replace(/^\//, ""),
          }))
        }
        placeholder="versions/<version-id>.json"
        mono
        disabled={disabled}
      />
      {draft.uiManifest && (
        <ConfigField
          id={`${idPrefix}-ui-pin-integrity`}
          label="Pin integrity (the manifest document's SRI)"
          value={draft.uiPinIntegrity}
          onChange={(value) => setDraft((prev) => ({ ...prev, uiPinIntegrity: value }))}
          placeholder="sha384-…"
          mono
          disabled={disabled}
        />
      )}
      {allowSsr && (
        <>
          <div className="flex flex-col gap-1">
            <ConfigField
              id={`${idPrefix}-ssr-url`}
              label="SSR bundle URL"
              value={draft.ssrUrl}
              onChange={(value) => setDraft((prev) => ({ ...prev, ssrUrl: value }))}
              onBlur={() =>
                setDraft((prev) => ({
                  ...prev,
                  ssrUrl: normalizeBundleBaseUrl(prev.ssrUrl),
                }))
              }
              placeholder="https://example.com/bundles/<account>/<gateway>/plugin/"
              mono
              disabled={disabled}
            />
            <Button
              type="button"
              onClick={() => void onVerifySsrBundle()}
              disabled={disabled || computing || !draft.ssrUrl}
              variant="link"
              size="xs"
              className="self-start"
              data-testid={`${idPrefix}-verify-ssr`}
            >
              {computing ? "Hashing…" : "Verify and fill integrity"}
            </Button>
          </div>
          <ConfigField
            id={`${idPrefix}-ssr-integrity`}
            label="SSR integrity"
            value={draft.ssrIntegrity}
            onChange={(value) => setDraft((prev) => ({ ...prev, ssrIntegrity: value }))}
            placeholder="sha384-…"
            mono
            disabled={disabled}
          />
        </>
      )}
    </FieldGroup>
  );
}
