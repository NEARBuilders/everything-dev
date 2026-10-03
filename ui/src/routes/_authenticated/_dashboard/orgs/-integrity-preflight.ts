import {
  type IntegrityCheckResult,
  type TenantConfigDraft,
  verifySsrIntegrity,
  verifyUiIntegrity,
  verifyUiPin,
} from "@/app";

export type IntegrityPreflight =
  | { status: "ok" }
  | { status: "mismatch"; message: string }
  | { status: "unverified"; message: string };

export async function runIntegrityPreflight(value: TenantConfigDraft): Promise<IntegrityPreflight> {
  const checks: { label: string; check: IntegrityCheckResult }[] = [];
  if (value.uiProduction && value.uiManifest && value.uiPinIntegrity) {
    checks.push({
      label: "UI pin",
      check: await verifyUiPin(value.uiProduction, {
        manifest: value.uiManifest,
        integrity: value.uiPinIntegrity,
      }),
    });
  } else if (value.uiProduction && value.uiIntegrity) {
    checks.push({
      label: "UI",
      check: await verifyUiIntegrity(value.uiProduction, value.uiIntegrity),
    });
  }
  if (value.ssrUrl && value.ssrIntegrity) {
    checks.push({
      label: "SSR",
      check: await verifySsrIntegrity(value.ssrUrl, value.ssrIntegrity),
    });
  }
  for (const { label, check } of checks) {
    if (check.status === "mismatch") {
      return {
        status: "mismatch",
        message: `${label} integrity mismatch — the bundle hashes to ${check.computed}`,
      };
    }
    if (check.status === "unverified") {
      return {
        status: "unverified",
        message: `Couldn't fetch the ${label} bundle to verify it (${check.reason}).`,
      };
    }
  }
  return { status: "ok" };
}
