import { CheckIcon } from "@phosphor-icons/react";
import { type ChangeEvent, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldLabel,
  Textarea,
} from "@/components";
import { ConnectDao } from "@/components/connect-dao";

interface ProposalReviewActionsProps {
  isPending: boolean;
  isNodeProposal: boolean;
  proposalDaoAccountId: string | null;
  daoIsVerified: boolean;
  rejectionReason: string;
  isReviewing: boolean;
  onDaoVerified: (value: { daoAccountId: string }) => void;
  onRejectionReasonChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onApprove: () => void;
  onReject: () => void;
}

export function ProposalReviewActions({
  isPending,
  isNodeProposal,
  proposalDaoAccountId,
  daoIsVerified,
  rejectionReason,
  isReviewing,
  onDaoVerified,
  onRejectionReasonChange,
  onApprove,
  onReject,
}: ProposalReviewActionsProps) {
  const [rejecting, setRejecting] = useState(false);
  if (!isPending) return null;

  return (
    <div className="flex flex-col gap-6" data-testid="admin-proposal-decision">
      <h2 className="text-xl font-semibold">Decision</h2>

      {isNodeProposal && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Connect{" "}
            <span className="font-mono break-all text-foreground">
              {proposalDaoAccountId ?? "the proposed DAO"}
            </span>{" "}
            to approve.
          </p>
          <ConnectDao purpose="proposal-review" variant="plain" onVerified={onDaoVerified} />
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <Button
            onClick={onApprove}
            disabled={isReviewing || !daoIsVerified}
            data-testid="admin-proposal-approve"
          >
            <CheckIcon />
            {isReviewing ? "Approving…" : "Approve"}
          </Button>
          <Button
            variant="ghost"
            onClick={() => setRejecting(true)}
            disabled={isReviewing}
            data-testid="admin-proposal-reject"
          >
            Reject
          </Button>
        </div>
        {!daoIsVerified && (
          <p className="text-sm text-muted-foreground">Approve unlocks once the DAO is verified.</p>
        )}
      </div>

      <Dialog open={rejecting} onOpenChange={setRejecting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject this proposal?</DialogTitle>
            <DialogDescription>Your reason is saved with the proposal.</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="rejection-reason">Reason</FieldLabel>
            <Textarea
              id="rejection-reason"
              value={rejectionReason}
              onChange={onRejectionReasonChange}
              placeholder="What needs to change"
              rows={4}
            />
            <FieldDescription>Required.</FieldDescription>
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(false)} disabled={isReviewing}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setRejecting(false);
                onReject();
              }}
              disabled={!rejectionReason.trim() || isReviewing}
              data-testid="admin-proposal-reject-confirm"
            >
              Reject proposal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
