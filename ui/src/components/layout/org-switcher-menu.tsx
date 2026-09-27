import { BuildingsIcon, CheckIcon, PlusIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import type { Organization } from "@/app";
import {
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { OrgMark } from "./org-mark";
import { useSwitchOrganization } from "./use-switch-organization";

interface OrgSwitcherMenuContentProps {
  organizations: Organization[];
  activeOrgId?: string | null;
  className?: string;
  align?: "start" | "end" | "center";
  side?: "top" | "right" | "bottom" | "left";
  sideOffset?: number;
  itemVariant?: "plain" | "iconTile";
}

export function OrgSwitcherMenuContent({
  organizations,
  activeOrgId,
  className = "w-60",
  align = "end",
  side,
  sideOffset,
  itemVariant = "plain",
}: OrgSwitcherMenuContentProps) {
  const switchOrg = useSwitchOrganization();

  const handleSwitch = (orgId: string) => {
    if (orgId === activeOrgId || switchOrg.isPending) return;
    switchOrg.mutate(orgId);
  };

  return (
    <DropdownMenuContent className={className} align={align} side={side} sideOffset={sideOffset}>
      <DropdownMenuGroup>
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        {organizations.map((org) => (
          <DropdownMenuItem
            key={org.id}
            onClick={() => handleSwitch(org.id)}
            disabled={switchOrg.isPending}
            data-testid={`org-switcher-item-${org.id}`}
          >
            {itemVariant === "iconTile" && <OrgMark name={org.name} size="sm" />}
            <span className="min-w-0 flex-1 truncate">{org.name}</span>
            {org.id === activeOrgId && <CheckIcon className="text-muted-foreground" />}
          </DropdownMenuItem>
        ))}
        {organizations.length === 0 && (
          <DropdownMenuItem disabled>No organizations yet</DropdownMenuItem>
        )}
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuItem render={<Link to="/orgs/new" />} data-testid="org-switcher-new">
        <PlusIcon />
        New organization
      </DropdownMenuItem>
      <DropdownMenuItem render={<Link to="/orgs" />} data-testid="org-switcher-all">
        <BuildingsIcon />
        All organizations
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
}
