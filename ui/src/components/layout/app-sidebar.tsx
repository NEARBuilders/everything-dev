import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
import { BookOpenIcon, CaretRightIcon, GearIcon } from "@phosphor-icons/react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { pluginPath } from "@/app";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { groupSidebarItems, isNavItemActive, navSlug, type SidebarItem } from "./nav-items";
import { SidebarOrgSwitcher } from "./sidebar-org-switcher";
import { SidebarTeamSwitcher } from "./sidebar-team-switcher";
import { useIdentity } from "./use-identity";
import { useSwitchTeam } from "./use-switch-team";
import { useTeamWorkspace } from "./use-team-workspace";

interface AppSidebarProps {
  items: SidebarItem[];
  appName: string;
  pathname: string;
}

export function AppSidebar({ items, appName, pathname }: AppSidebarProps) {
  const { user, organizations, activeOrgId } = useIdentity();
  const { data: workspace } = useTeamWorkspace(!!user);
  const switchTeam = useSwitchTeam();
  const tab = useRouterState({
    select: (s) => {
      const value = (s.location.search as { tab?: unknown }).tab;
      return typeof value === "string" ? value : undefined;
    },
  });
  const search = { tab };
  const teams = workspace?.teams ?? [];
  const activeTeamId = workspace?.activeTeam?.id ?? null;
  const sections = groupSidebarItems(items);
  const { isMobile, setOpenMobile } = useSidebar();

  useEffect(() => {
    if (isMobile && pathname) setOpenMobile(false);
  }, [isMobile, pathname, setOpenMobile]);

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarOrgSwitcher
          appName={appName}
          organizations={organizations}
          activeOrgId={activeOrgId}
        />
        <SidebarTeamSwitcher
          teams={teams}
          activeTeamId={activeTeamId}
          isPending={switchTeam.isPending}
          onSelect={(teamId) => switchTeam.mutate(teamId)}
        />
      </SidebarHeader>

      <SidebarContent>
        {sections.map((section) => (
          <SidebarGroup key={section.key}>
            {section.label && <SidebarGroupLabel>{section.label}</SidebarGroupLabel>}
            <SidebarMenu>
              {section.items.map((item) => (
                <SidebarNavItem
                  key={`${item.label}-${item.to}`}
                  item={item}
                  pathname={pathname}
                  search={search}
                />
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={pathname.startsWith("/settings")}
              tooltip="Settings"
              render={<Link to={pluginPath("/settings")} data-testid="sidebar-nav-settings" />}
            >
              <GearIcon />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={pathname === "/about" || pathname === "/skill"}
              tooltip="Docs"
              render={<Link to="/about" data-testid="sidebar-nav-docs" />}
            >
              <BookOpenIcon />
              <span>Docs</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

interface NavItemProps {
  item: SidebarItem;
  pathname: string;
  search: Record<string, unknown>;
}

function SidebarNavItem(props: NavItemProps) {
  if (props.item.children && props.item.children.length > 0) {
    return <SidebarNavGroup {...props} />;
  }
  return <SidebarNavLeaf {...props} />;
}

function SidebarNavLeaf({ item, pathname, search }: NavItemProps) {
  const Icon = item.icon;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isNavItemActive(item, pathname, search)}
        tooltip={item.label}
        render={
          <Link
            to={item.to}
            search={item.search}
            preload="intent"
            data-testid={`sidebar-nav-${navSlug(item)}`}
          />
        }
      >
        <Icon />
        <span>{item.label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function SidebarNavSubItem({ item, pathname, search }: NavItemProps) {
  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton
        isActive={isNavItemActive(item, pathname, search)}
        render={
          <Link
            to={item.to}
            search={item.search}
            preload="intent"
            data-testid={`sidebar-nav-${navSlug(item)}`}
          />
        }
      >
        <span>{item.label}</span>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  );
}

function SidebarNavGroup({ item, pathname, search }: NavItemProps) {
  const Icon = item.icon;
  const active = isNavItemActive(item, pathname, search);
  const children = item.children ?? [];
  const [open, setOpen] = useState(active);
  const slug = navSlug(item);

  useEffect(() => {
    if (active) setOpen(true);
  }, [active]);

  return (
    <CollapsiblePrimitive.Root
      className="group/collapsible"
      open={open}
      onOpenChange={setOpen}
      render={<SidebarMenuItem />}
    >
      <SidebarMenuButton
        isActive={active && !open}
        tooltip={item.label}
        render={
          <Link
            to={item.to}
            search={item.search}
            preload="intent"
            onClick={() => setOpen(true)}
            data-testid={`sidebar-nav-${slug}`}
          />
        }
      >
        <Icon />
        <span>{item.label}</span>
      </SidebarMenuButton>
      <CollapsiblePrimitive.Trigger
        render={
          <SidebarMenuAction
            aria-label={`Toggle ${item.label}`}
            data-testid={`sidebar-nav-${slug}-toggle`}
          />
        }
      >
        <CaretRightIcon className="transition-transform duration-200 group-data-open/collapsible:rotate-90" />
      </CollapsiblePrimitive.Trigger>
      <CollapsiblePrimitive.Panel className="h-(--collapsible-panel-height) overflow-hidden transition-all duration-200 ease-out data-ending-style:h-0 data-starting-style:h-0">
        <SidebarMenuSub>
          {children.map((child) => (
            <SidebarNavSubItem
              key={`${child.label}-${child.to}`}
              item={child}
              pathname={pathname}
              search={search}
            />
          ))}
        </SidebarMenuSub>
      </CollapsiblePrimitive.Panel>
    </CollapsiblePrimitive.Root>
  );
}
