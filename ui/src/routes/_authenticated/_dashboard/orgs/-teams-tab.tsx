import { PlusIcon, UsersThreeIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { Button, EmptyState, Input, SectionHeader, TabsContent } from "@/components";
import type { MemberCardMember } from "./-member-card";
import { TeamCard, type TeamCardTeam, type TeamMembershipStatus } from "./-team-card";

export type TeamsTabTeam = TeamCardTeam;
export type { TeamMembershipStatus };

export function TeamsTab({
  canManage,
  isMutating,
  onAddMember,
  onAreasChange,
  onCreate,
  onDelete,
  onRemoveMember,
  onRetryMembers,
  onRename,
  orgMembers,
  teams,
}: {
  canManage: boolean;
  isMutating: boolean;
  onAddMember: (teamId: string, userId: string) => void;
  onAreasChange: (teamId: string, areas: string[]) => void;
  onCreate: (name: string) => void;
  onDelete: (teamId: string) => void;
  onRemoveMember: (teamId: string, userId: string) => void;
  onRetryMembers?: (teamId: string) => void;
  onRename: (teamId: string, name: string) => void;
  orgMembers: MemberCardMember[];
  teams: TeamsTabTeam[];
}) {
  const [teamName, setTeamName] = useState("");
  const trimmedName = teamName.trim();

  return (
    <TabsContent value="teams" className="flex flex-col gap-6 pt-6">
      <SectionHeader
        title="Teams"
        description="Members acting as a team only see the areas it can use."
      />
      {canManage && (
        <form
          className="flex w-full max-w-lg gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!trimmedName) return;
            onCreate(trimmedName);
            setTeamName("");
          }}
        >
          <Input
            value={teamName}
            onChange={(event) => setTeamName(event.target.value)}
            placeholder="New team, e.g. Finance"
            aria-label="Team name"
            className="min-w-0 flex-1"
            data-testid="teams-tab-create-input"
          />
          <Button
            type="submit"
            variant="outline"
            disabled={isMutating || !trimmedName}
            data-testid="teams-tab-create-button"
          >
            <PlusIcon />
            Create team
          </Button>
        </form>
      )}

      {teams.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {teams.map((team) => (
            <TeamCard
              key={team.id}
              canManage={canManage}
              isMutating={isMutating}
              onAddMember={(userId) => onAddMember(team.id, userId)}
              onAreasChange={(areas) => onAreasChange(team.id, areas)}
              onDelete={() => onDelete(team.id)}
              onRemoveMember={(userId) => onRemoveMember(team.id, userId)}
              onRetryMembers={onRetryMembers ? () => onRetryMembers(team.id) : undefined}
              onRename={(name) => onRename(team.id, name)}
              orgMembers={orgMembers}
              team={team}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={UsersThreeIcon}
          title="No teams yet"
          description={canManage ? "Create one above to group people by what they do." : undefined}
        />
      )}
    </TabsContent>
  );
}
