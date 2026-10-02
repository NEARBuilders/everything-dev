import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useApiClient } from "@/app";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { invalidateNodeQueries, nodeByIdQueryOptions } from "@/lib/queries/nodes";

const BULLETIN_MAX_LENGTH = 2000;

export function BulletinEditor({ nodeId }: { nodeId: string }) {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const nodeQuery = useQuery(nodeByIdQueryOptions(api, nodeId));
  const node = nodeQuery.data;
  const [bulletin, setBulletin] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (dirty || !node) return;
    setBulletin(typeof node.metadata.bulletin === "string" ? node.metadata.bulletin : "");
  }, [node, dirty]);

  const save = useMutation({
    mutationFn: () =>
      api.setNodeBulletin({ nodeId, bulletin: bulletin.trim() ? bulletin.trim() : null }),
    onSuccess: async () => {
      setDirty(false);
      toast.success(bulletin.trim() ? "Bulletin published" : "Bulletin cleared");
      await invalidateNodeQueries(queryClient);
    },
    onError: (error: Error) => toast.error(error.message || "Couldn't save the bulletin."),
  });

  if (nodeQuery.isPending) {
    return (
      <div className="flex flex-col gap-8" aria-busy="true">
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    );
  }

  if (!node) {
    return <p className="text-sm text-muted-foreground">Couldn't load this community.</p>;
  }

  return (
    <form
      className="flex flex-col gap-8"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <Field>
        <FieldLabel htmlFor="node-bulletin">Dashboard bulletin</FieldLabel>
        <FieldDescription>
          A short announcement shown on your community's dashboard and public page. Supports
          markdown. Leave blank to remove it.
        </FieldDescription>
        <Textarea
          id="node-bulletin"
          value={bulletin}
          maxLength={BULLETIN_MAX_LENGTH}
          rows={5}
          placeholder="More features are coming soon…"
          onChange={(event) => {
            setDirty(true);
            setBulletin(event.target.value);
          }}
        />
      </Field>
      {bulletin.trim() && (
        <Field>
          <FieldLabel>Preview</FieldLabel>
          <div className="rounded-2xl border border-border bg-muted/50 p-4">
            <Markdown content={bulletin} variant="compact" />
          </div>
        </Field>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" data-testid="bulletin-editor-save" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save bulletin"}
        </Button>
      </div>
    </form>
  );
}
