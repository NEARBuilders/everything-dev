import { CaretUpDownIcon, StackIcon, UsersIcon } from "@phosphor-icons/react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import type { WorkspaceTeam } from "@/lib/team-workspace";

interface SidebarTeamSwitcherProps {
  teams: WorkspaceTeam[];
  activeTeamId: string | null;
  isPending: boolean;
  onSelect: (teamId: string | null) => void;
}

export function SidebarTeamSwitcher({
  teams,
  activeTeamId,
  isPending,
  onSelect,
}: SidebarTeamSwitcherProps) {
  if (teams.length === 0) return null;
  const activeTeam = teams.find((team) => team.id === activeTeamId);

  const select = (teamId: string | null) => {
    if (teamId === (activeTeam?.id ?? null) || isPending) return;
    onSelect(teamId);
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<SidebarMenuButton data-testid="team-switcher" disabled={isPending} />}
          >
            <UsersIcon />
            <span className="min-w-0 flex-1 truncate">
              <span className="text-muted-foreground">Team: </span>
              {activeTeam?.name ?? "All areas"}
            </span>
            <CaretUpDownIcon className="ml-auto size-4 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--anchor-width) min-w-56"
            align="start"
            side="bottom"
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel>Work as a team</DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            {teams.map((team) => (
              <DropdownMenuCheckboxItem
                key={team.id}
                checked={team.id === activeTeam?.id}
                disabled={isPending}
                closeOnClick
                onClick={() => select(team.id)}
                data-testid={`team-switcher-item-${team.id}`}
              >
                <span className="truncate">{team.name}</span>
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={!activeTeam}
              disabled={isPending}
              closeOnClick
              onClick={() => select(null)}
              data-testid="team-switcher-item-all"
            >
              <StackIcon />
              All areas
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
