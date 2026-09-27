import { LockSimpleIcon, PlusIcon, XIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { type ApiClient, useApiClient } from "@/app";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ActivityEditor } from "./activity-editor";

type Profile = NonNullable<Awaited<ReturnType<ApiClient["getDiscoveryProfile"]>>>;
export type ProfileEditorTab = "profile" | "events";

export function ProfileEditor({
  nodeId,
  defaultTab = "profile",
  tab,
  onTabChange,
}: {
  nodeId: string;
  defaultTab?: ProfileEditorTab;
  tab?: ProfileEditorTab;
  onTabChange?: (tab: ProfileEditorTab) => void;
}) {
  const api = useApiClient();
  const [localTab, setLocalTab] = useState<ProfileEditorTab>(defaultTab);
  const current = tab ?? localTab;
  const select = (next: ProfileEditorTab) => {
    setLocalTab(next);
    onTabChange?.(next);
  };
  const query = useQuery({
    queryKey: ["discovery-profile", nodeId],
    queryFn: () => api.getDiscoveryProfile({ nodeId }),
    retry: false,
  });
  if (query.isPending)
    return (
      <div className="flex flex-col gap-8">
        <Skeleton className="h-11 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  if (query.isError)
    return (
      <EmptyState
        icon={LockSimpleIcon}
        title="You can't edit this community"
        description="Only its owners and admins can change the profile or publish events."
      />
    );
  return (
    <Tabs
      value={current}
      onValueChange={(value) => select(value === "profile" ? "profile" : "events")}
    >
      <TabsList>
        <TabsTrigger value="events" data-testid="content-tab-events">
          Events
        </TabsTrigger>
        <TabsTrigger value="profile" data-testid="content-tab-profile">
          Profile
        </TabsTrigger>
      </TabsList>
      <TabsContent value="events" className="flex flex-col gap-8 pt-8">
        {!query.data?.published && (
          <div
            className="flex flex-wrap items-center gap-3 text-sm"
            data-testid="content-not-published"
          >
            <Badge variant="warning">Hidden from Explore</Badge>
            <span className="text-muted-foreground">
              Published events show up once your profile is public.
            </span>
            <Button variant="link" size="xs" onClick={() => select("profile")}>
              Open profile
            </Button>
          </div>
        )}
        <ActivityEditor nodeId={nodeId} />
      </TabsContent>
      <TabsContent value="profile" className="pt-8">
        <ProfileForm
          key={nodeId}
          initial={
            query.data ?? {
              nodeId,
              summary: "",
              location: "",
              region: "",
              latitude: null,
              longitude: null,
              channels: [],
              published: false,
            }
          }
        />
      </TabsContent>
    </Tabs>
  );
}

function ProfileForm({ initial }: { initial: Profile }) {
  const [profile, setProfile] = useState(initial);
  const api = useApiClient();
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: () => api.saveDiscoveryProfile(profile),
    onSuccess: () => {
      toast.success(profile.published ? "Profile saved and live on Explore" : "Profile saved");
      return client.invalidateQueries({
        predicate: (q) => String(q.queryKey[0]).startsWith("discovery"),
      });
    },
    onError: (error: Error) => toast.error(error.message || "Couldn't save the profile."),
  });
  const setChannel = (index: number, patch: Partial<Profile["channels"][number]>) =>
    setProfile({
      ...profile,
      channels: profile.channels.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    });
  return (
    <form
      className="flex max-w-2xl flex-col gap-10"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="profile-published">Show on Explore</FieldLabel>
          <FieldDescription>People can find this community and its events.</FieldDescription>
        </FieldContent>
        <Switch
          id="profile-published"
          checked={profile.published}
          onCheckedChange={(checked) => setProfile({ ...profile, published: checked })}
        />
      </Field>

      <FieldSet>
        <FieldLegend>About</FieldLegend>
        <Field>
          <FieldLabel htmlFor="profile-summary">Description</FieldLabel>
          <Textarea
            id="profile-summary"
            value={profile.summary}
            placeholder="Who is this community for? What do you do together?"
            maxLength={1000}
            onChange={(e) => setProfile({ ...profile, summary: e.target.value })}
          />
        </Field>
      </FieldSet>

      <FieldSet>
        <FieldLegend>Where you meet</FieldLegend>
        <FieldGroup>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="profile-location">City or venue</FieldLabel>
              <Input
                id="profile-location"
                value={profile.location}
                maxLength={120}
                onChange={(e) => setProfile({ ...profile, location: e.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="profile-region">Region</FieldLabel>
              <Input
                id="profile-region"
                value={profile.region}
                maxLength={120}
                onChange={(e) => setProfile({ ...profile, region: e.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="profile-latitude">Latitude</FieldLabel>
              <Input
                id="profile-latitude"
                type="number"
                step="any"
                min={-85}
                max={85}
                value={profile.latitude ?? ""}
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    latitude: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="profile-longitude">Longitude</FieldLabel>
              <Input
                id="profile-longitude"
                type="number"
                step="any"
                min={-180}
                max={180}
                value={profile.longitude ?? ""}
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    longitude: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
            </Field>
          </div>
          <FieldDescription>
            The map pin should be a public place. Leave it empty if you only meet online.
          </FieldDescription>
        </FieldGroup>
      </FieldSet>

      <FieldSet>
        <FieldLegend>Where people can join</FieldLegend>
        <FieldGroup>
          {profile.channels.map((channel, index) => (
            <div key={index} className="flex flex-wrap items-end gap-2 sm:flex-nowrap">
              <Field className="w-full sm:w-36 sm:shrink-0">
                <FieldLabel htmlFor={`channel-label-${index}`}>Name</FieldLabel>
                <Input
                  id={`channel-label-${index}`}
                  required
                  placeholder="Telegram"
                  value={channel.label}
                  onChange={(e) => setChannel(index, { label: e.target.value })}
                />
              </Field>
              <Field className="min-w-0 flex-1">
                <FieldLabel htmlFor={`channel-url-${index}`}>Link</FieldLabel>
                <Input
                  id={`channel-url-${index}`}
                  required
                  type="url"
                  placeholder="https://"
                  value={channel.url}
                  onChange={(e) => setChannel(index, { url: e.target.value })}
                />
              </Field>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove ${channel.label || "link"}`}
                onClick={() =>
                  setProfile({
                    ...profile,
                    channels: profile.channels.filter((_, i) => i !== index),
                  })
                }
              >
                <XIcon />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            disabled={profile.channels.length >= 10}
            onClick={() =>
              setProfile({ ...profile, channels: [...profile.channels, { label: "", url: "" }] })
            }
          >
            <PlusIcon />
            Add link
          </Button>
        </FieldGroup>
      </FieldSet>

      <div className="flex flex-col gap-2">
        <Button
          data-testid="discovery-profile-save"
          className="self-start"
          disabled={save.isPending}
        >
          {save.isPending ? "Saving…" : "Save profile"}
        </Button>
        {save.isError && (
          <p role="alert" className="text-sm text-destructive">
            {save.error.message}
          </p>
        )}
      </div>
    </form>
  );
}
