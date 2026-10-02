import { DotsThreeIcon, PlusIcon, UsersThreeIcon } from "@phosphor-icons/react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useApiClient, useAuthClient } from "@/app";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { InfoPopover } from "@/components/info-popover";
import { SectionHeader } from "@/components/layout/section-header";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";

type Person = { id: string; name: string | null; image: string | null };

export function initialsFor(name: string | null, fallback: string) {
  const source = (name ?? "").trim() || fallback;
  const parts = source.split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0]?.[0]}${parts[1]?.[0]}` : source.slice(0, 2)).toUpperCase();
}

function PersonMedia({ person }: { person: Person }) {
  return (
    <ItemMedia>
      <Avatar>
        {person.image && <AvatarImage src={person.image} alt="" />}
        <AvatarFallback>{initialsFor(person.name, person.id)}</AvatarFallback>
      </Avatar>
    </ItemMedia>
  );
}

export function CurateTeam({ curators }: { curators: string[] }) {
  const api = useApiClient();
  const auth = useAuthClient();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [removing, setRemoving] = useState<Person | null>(null);
  const term = query.trim();

  const people = useQueries({
    queries: curators.map((id) => ({
      queryKey: ["curate-person", id],
      staleTime: 5 * 60 * 1000,
      queryFn: async (): Promise<Person> => {
        const { data } = await auth.admin.getUser({ query: { id } });
        return { id, name: data?.name ?? null, image: data?.image ?? null };
      },
    })),
  });
  const search = useQuery({
    queryKey: ["curate-people-search", term],
    enabled: term.length >= 2,
    staleTime: 30 * 1000,
    queryFn: async (): Promise<Person[]> => {
      const { data } = await auth.admin.listUsers({
        query: { searchValue: term, searchField: "name", searchOperator: "contains", limit: 5 },
      });
      return (data?.users ?? []).map((user) => ({
        id: user.id,
        name: user.name,
        image: user.image ?? null,
      }));
    },
  });

  const setCurator = useMutation({
    mutationFn: ({ userId, enabled }: { userId: string; enabled: boolean }) =>
      api.setDiscoveryCurator({ userId, enabled }),
    onSuccess: async (_, { enabled }) => {
      toast.success(enabled ? "Curator added" : "Curator access removed");
      setQuery("");
      setRemoving(null);
      await queryClient.invalidateQueries({ queryKey: ["discover"] });
    },
    onError: (error: Error) => toast.error(error.message || "Couldn't update curators."),
  });

  const matches = (search.data ?? []).filter((person) => !curators.includes(person.id));
  const add = (userId: string) => setCurator.mutate({ userId, enabled: true });

  return (
    <section className="flex max-w-2xl flex-col gap-6">
      <SectionHeader
        title="Curators"
        description="People who can feature communities and see engagement."
        action={
          <InfoPopover
            title="What curators can do"
            body="Curators feature communities and see which links people open. They can't edit a community's page, add events or handle reports."
            testId="curate-team-info"
          />
        }
      />
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (term) add(matches[0]?.id ?? term);
        }}
      >
        <InputGroup>
          <InputGroupAddon>
            <UsersThreeIcon />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Find a person"
            data-testid="curate-team-search"
            placeholder="Search by name or paste an account ID"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              type="submit"
              variant="default"
              data-testid="curate-team-add"
              disabled={!term || setCurator.isPending}
            >
              <PlusIcon />
              Add
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        {matches.length > 0 && (
          <ItemGroup data-testid="curate-team-matches">
            {matches.map((person) => (
              <Item key={person.id} variant="muted" size="sm">
                <PersonMedia person={person} />
                <ItemContent className="min-w-0">
                  <ItemTitle>{person.name || "Unnamed"}</ItemTitle>
                  <ItemDescription>
                    <span className="block truncate font-mono">{person.id}</span>
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={setCurator.isPending}
                    data-testid={`curate-team-match-${person.id}`}
                    onClick={() => add(person.id)}
                  >
                    Add
                  </Button>
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        )}
      </form>

      {curators.length === 0 ? (
        <EmptyState
          icon={UsersThreeIcon}
          title="No curators yet"
          description="Add someone to help highlight good communities."
        />
      ) : (
        <ItemGroup data-testid="curate-team-list">
          {curators.map((id, index) => {
            const person = people[index]?.data ?? { id, name: null, image: null };
            const label = person.name || "Unknown person";
            return (
              <Item key={id} variant="outline" data-testid={`curate-team-member-${id}`}>
                <PersonMedia person={person} />
                <ItemContent className="min-w-0">
                  <ItemTitle>{label}</ItemTitle>
                  <ItemDescription>
                    <span className="block truncate font-mono">{id}</span>
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`More for ${label}`}
                          data-testid={`curate-team-menu-${id}`}
                        />
                      }
                    >
                      <DotsThreeIcon />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => setRemoving({ ...person, name: label })}
                      >
                        Remove access
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </ItemActions>
              </Item>
            );
          })}
        </ItemGroup>
      )}

      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={`Remove ${removing?.name ?? "this person"}?`}
        description="They'll no longer be able to feature communities or see engagement."
        confirmLabel="Remove access"
        cancelLabel="Cancel"
        variant="destructive"
        isPending={setCurator.isPending}
        onConfirm={() => {
          if (removing) setCurator.mutate({ userId: removing.id, enabled: false });
        }}
      />
    </section>
  );
}
