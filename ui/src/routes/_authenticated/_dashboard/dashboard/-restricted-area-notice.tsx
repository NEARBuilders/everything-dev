import { LockSimpleIcon } from "@phosphor-icons/react";
import { FEATURE_AREA_LABELS, type FeatureArea } from "@/lib/feature-areas";

export function RestrictedAreaNotice({ area }: { area: FeatureArea | "admin" }) {
  return (
    <div
      role="alert"
      className="flex items-center gap-3 rounded-2xl bg-warning-muted px-4 py-3 text-sm text-warning-muted-foreground"
      data-testid="workspace-restricted-notice"
    >
      <LockSimpleIcon className="size-4 shrink-0" />
      {area === "admin" ? (
        <p>
          <span className="font-medium">Admin</span> is only for platform admins.
        </p>
      ) : (
        <p>
          <span className="font-medium">{FEATURE_AREA_LABELS[area]}</span> isn't open to your team.
          Switch teams in the sidebar or ask an owner.
        </p>
      )}
    </div>
  );
}
