import { CaretUpDownIcon } from "@phosphor-icons/react";
import type { Organization } from "@/app";
import { LogoMark } from "@/components/logo";
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { OrgMark } from "./org-mark";
import { OrgSwitcherMenuContent } from "./org-switcher-menu";

interface SidebarOrgSwitcherProps {
  appName: string;
  organizations: Organization[];
  activeOrgId?: string | null;
}

export function SidebarOrgSwitcher({
  appName,
  organizations,
  activeOrgId,
}: SidebarOrgSwitcherProps) {
  const activeOrg = organizations.find((o) => o.id === activeOrgId);

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger render={<SidebarMenuButton size="lg" data-testid="org-switcher" />}>
            {activeOrg ? <OrgMark name={activeOrg.name} /> : <LogoMark />}
            <div className="grid flex-1 text-left leading-tight">
              <span className="truncate text-sm font-semibold">{activeOrg?.name ?? appName}</span>
              <span className="truncate text-xs text-muted-foreground">
                {activeOrg ? "Organization" : "Choose an organization"}
              </span>
            </div>
            <CaretUpDownIcon className="ml-auto size-4 text-muted-foreground" />
          </DropdownMenuTrigger>
          <OrgSwitcherMenuContent
            organizations={organizations}
            activeOrgId={activeOrgId}
            className="w-(--anchor-width) min-w-60"
            align="start"
            side="bottom"
            sideOffset={4}
            itemVariant="iconTile"
          />
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
