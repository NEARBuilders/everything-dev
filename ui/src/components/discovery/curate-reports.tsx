import { ArrowUpRightIcon, ShieldCheckIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { type ApiClient, useApiClient } from "@/app";
import { EmptyState } from "@/components/empty-state";
import { SectionHeader } from "@/components/layout/section-header";
import { LocalDate } from "@/components/local-date";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { DiscoveryAction } from "./discovery-action";

type Studio = Awaited<ReturnType<ApiClient["getDiscoveryStudio"]>>;
type Report = Studio["reports"][number];

function targetLink(report: Report) {
  return report.kind === "profile" ? (
    <Link to="/explore" search={{ node: report.targetId }} target="_blank" />
  ) : (
    <Link to="/activity/$activityId" params={{ activityId: report.targetId }} target="_blank" />
  );
}

export function CurateReports({ studio }: { studio: Studio }) {
  const api = useApiClient();
  const [resolving, setResolving] = useState<Report | null>(null);
  const [action, setAction] = useState<"dismiss" | "unpublish">("dismiss");
  const open = studio.reports.filter((report) => !report.resolved);
  const resolved = studio.reports.filter((report) => report.resolved);
  const targetName = (report: Report) => {
    if (report.kind === "profile")
      return studio.nodes.find((node) => node.nodeId === report.targetId)?.name ?? "A community";
    for (const node of studio.nodes) {
      const match = [...node.events, ...node.updates].find((item) => item.id === report.targetId);
      if (match) return match.title;
    }
    return "An event or post";
  };

  return (
    <div className="flex flex-col gap-12">
      <section className="flex flex-col gap-4">
        <SectionHeader title="Open reports" />
        {open.length === 0 ? (
          <EmptyState
            icon={ShieldCheckIcon}
            title="You're all caught up"
            description="New visitor reports show up here."
          />
        ) : (
          <ItemGroup data-testid="curate-reports-open">
            {open.map((report, index) => (
              <Item key={report.id} variant="outline" data-testid={`curate-report-${report.id}`}>
                <ItemContent>
                  <ItemTitle className="flex-wrap">
                    <span className="min-w-0 truncate">{targetName(report)}</span>
                    <Badge variant="outline">
                      {report.kind === "profile" ? "Community page" : "Event or post"}
                    </Badge>
                  </ItemTitle>
                  <ItemDescription>
                    “{report.reason}” · <LocalDate value={report.createdAt} format="relative" />
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button
                    size="sm"
                    variant="ghost"
                    nativeButton={false}
                    render={targetLink(report)}
                  >
                    View
                    <ArrowUpRightIcon />
                  </Button>
                  <Button
                    size="sm"
                    variant={index === 0 ? "default" : "outline"}
                    data-testid={`discovery-report-open-${report.id}`}
                    onClick={() => {
                      setAction("dismiss");
                      setResolving(report);
                    }}
                  >
                    Resolve
                  </Button>
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        )}
      </section>

      {resolved.length > 0 && (
        <section className="flex flex-col gap-4">
          <SectionHeader title="Resolved" />
          <ItemGroup>
            {resolved.map((report) => (
              <Item key={report.id} variant="muted" size="sm">
                <ItemContent>
                  <ItemTitle>{targetName(report)}</ItemTitle>
                  <ItemDescription>{report.note || report.reason}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <span className="text-sm text-muted-foreground">
                    <LocalDate value={report.createdAt} />
                  </span>
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        </section>
      )}

      <Dialog
        open={!!resolving}
        onOpenChange={(next) => {
          if (!next) setResolving(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve report</DialogTitle>
            <DialogDescription>
              {resolving ? `“${resolving.reason}”` : "Decide what happens to this content."}
            </DialogDescription>
          </DialogHeader>
          {resolving && (
            <DiscoveryAction
              testId={`discovery-resolve-report-${resolving.id}`}
              label={action === "unpublish" ? "Hide and resolve" : "Keep and resolve"}
              variant={action === "unpublish" ? "destructive" : "default"}
              successMessage="Report resolved"
              onDone={() => setResolving(null)}
              run={(data) =>
                api.moderateDiscoveryReport({
                  reportId: resolving.id,
                  action,
                  note: String(data.get("note")),
                })
              }
            >
              <FieldSet>
                <FieldLegend variant="label">What should happen?</FieldLegend>
                <RadioGroup
                  value={action}
                  onValueChange={(value) =>
                    setAction(value === "unpublish" ? "unpublish" : "dismiss")
                  }
                >
                  <Field orientation="horizontal">
                    <RadioGroupItem id="report-action-dismiss" value="dismiss" />
                    <FieldLabel htmlFor="report-action-dismiss">Keep the content</FieldLabel>
                  </Field>
                  <Field orientation="horizontal">
                    <RadioGroupItem id="report-action-unpublish" value="unpublish" />
                    <FieldLabel htmlFor="report-action-unpublish">Hide it from Explore</FieldLabel>
                  </Field>
                </RadioGroup>
              </FieldSet>
              <Field>
                <FieldLabel htmlFor={`note-${resolving.id}`}>Note for your team</FieldLabel>
                <Textarea id={`note-${resolving.id}`} name="note" required maxLength={1000} />
              </Field>
            </DiscoveryAction>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
