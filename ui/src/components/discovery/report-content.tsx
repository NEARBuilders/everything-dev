import { FlagIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { useApiClient } from "@/app";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { DiscoveryAction } from "./discovery-action";

export function ReportContent({
  targetId,
  kind,
}: {
  targetId: string;
  kind: "profile" | "activity";
}) {
  const api = useApiClient();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            className="self-start"
            data-testid={`discovery-report-${targetId}`}
          />
        }
      >
        <FlagIcon />
        Report a problem
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report a problem</DialogTitle>
          <DialogDescription>
            Only the people who look after CityNode see reports.
          </DialogDescription>
        </DialogHeader>
        <DiscoveryAction
          testId={`discovery-report-submit-${targetId}`}
          label="Send report"
          successMessage="Report sent. Thanks for letting us know."
          onDone={() => setOpen(false)}
          run={(data) => {
            let token = sessionStorage.getItem("discovery-report-token");
            if (!token) {
              token = crypto.randomUUID();
              sessionStorage.setItem("discovery-report-token", token);
            }
            return api.reportDiscoveryContent({
              targetId,
              kind,
              token,
              reason: String(data.get("reason")),
            });
          }}
        >
          <Field>
            <FieldLabel htmlFor={`report-${targetId}`}>What's wrong?</FieldLabel>
            <Textarea
              id={`report-${targetId}`}
              data-testid={`discovery-report-reason-${targetId}`}
              name="reason"
              required
              minLength={5}
              maxLength={1000}
            />
          </Field>
        </DiscoveryAction>
      </DialogContent>
    </Dialog>
  );
}
