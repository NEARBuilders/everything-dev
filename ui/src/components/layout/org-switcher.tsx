import { BankIcon } from "@phosphor-icons/react";
import type { Organization } from "@/app";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { OrgSwitcherMenuContent } from "./org-switcher-menu";

interface OrgSwitcherProps {
  organizations: Organization[];
  activeOrgId?: string | null;
}

export function OrgSwitcher({ organizations, activeOrgId }: OrgSwitcherProps) {
  const activeOrg = organizations.find((o) => o.id === activeOrgId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="sm" className="hidden sm:flex max-w-45" />}
      >
        <BankIcon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate min-w-0">{activeOrg?.name ?? "workspace"}</span>
      </DropdownMenuTrigger>
      <OrgSwitcherMenuContent organizations={organizations} activeOrgId={activeOrgId} align="end" />
    </DropdownMenu>
  );
}
