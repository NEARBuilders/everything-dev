import { type FormEvent, useEffect, useState } from "react";
import { LocalDate } from "@/components/local-date";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import type { AdminSession, AdminUser } from "./-admin-users-types";

const DAY = 24 * 60 * 60;

const BAN_EXPIRY_ITEMS = [
  { label: "Permanent", value: "0" },
  { label: "1 day", value: String(DAY) },
  { label: "7 days", value: String(7 * DAY) },
  { label: "30 days", value: String(30 * DAY) },
];

export function AdminBanDialog({
  user,
  open,
  onOpenChange,
  onBan,
  isPending,
}: {
  user: AdminUser | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBan: (input: { userId: string; banReason?: string; banExpiresIn?: number }) => void;
  isPending: boolean;
}) {
  const [reason, setReason] = useState("");
  const [expiresIn, setExpiresIn] = useState("0");

  useEffect(() => {
    if (open) {
      setReason("");
      setExpiresIn("0");
    }
  }, [open]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) return;
    const seconds = Number(expiresIn);
    onBan({
      userId: user.id,
      ...(reason.trim() ? { banReason: reason.trim() } : {}),
      ...(seconds > 0 ? { banExpiresIn: seconds } : {}),
    });
  };

  return (
    <Dialog open={open && !!user} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ban {user?.name || user?.email || "user"}?</DialogTitle>
          <DialogDescription>
            They can't sign in while banned. Existing sessions are revoked on next use.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="admin-users.ban-reason">Reason</FieldLabel>
            <Input
              id="admin-users.ban-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Shown to the user at sign-in"
              maxLength={2000}
              data-testid="admin-users.ban-reason"
            />
          </Field>
          <Field>
            <FieldLabel>Expires</FieldLabel>
            <Select value={expiresIn} onValueChange={setExpiresIn}>
              <SelectTrigger data-testid="admin-users.ban-expiry">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BAN_EXPIRY_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={isPending}>
              {isPending ? <Spinner /> : null}
              Ban user
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AdminRoleDialog({
  user,
  open,
  onOpenChange,
  onSetRole,
  isPending,
}: {
  user: AdminUser | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSetRole: (input: { userId: string; role: "admin" | "user" }) => void;
  isPending: boolean;
}) {
  const [role, setRole] = useState<"admin" | "user">("user");

  useEffect(() => {
    if (open && user) setRole(user.role === "admin" ? "admin" : "user");
  }, [open, user]);

  return (
    <Dialog open={open && !!user} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Platform role for {user?.name || user?.email || "user"}</DialogTitle>
          <DialogDescription>
            Admins manage the platform: users, organizations and system settings.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel>Role</FieldLabel>
            <Select
              value={role}
              onValueChange={(value) => setRole(value === "admin" ? "admin" : "user")}
            >
              <SelectTrigger data-testid="admin-users.role-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">User</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!user) return;
                onSetRole({ userId: user.id, role });
                onOpenChange(false);
              }}
              disabled={isPending}
              data-testid="admin-users.role-confirm"
            >
              {isPending ? <Spinner /> : null}
              Save role
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AdminSessionsDialog({
  userId,
  open,
  onOpenChange,
  sessions,
  isLoading,
  onRevokeSession,
  onRevokeAll,
  revokingToken,
  isRevokingAll,
}: {
  userId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: AdminSession[];
  isLoading: boolean;
  onRevokeSession: (sessionToken: string) => void;
  onRevokeAll: () => void;
  revokingToken: string | null;
  isRevokingAll: boolean;
}) {
  return (
    <Dialog open={open && !!userId} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Sessions</DialogTitle>
          <DialogDescription>
            {sessions.length} active session{sessions.length === 1 ? "" : "s"}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2" data-testid="admin-users.sessions-list">
          {isLoading ? (
            <Spinner className="mx-auto" />
          ) : sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active sessions.</p>
          ) : (
            sessions.map((session) => (
              <div
                key={session.id}
                className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
              >
                <div className="flex min-w-0 flex-col gap-0.5 text-sm">
                  <span className="text-muted-foreground">
                    {session.ipAddress ?? "unknown IP"} · expires{" "}
                    <LocalDate value={session.expiresAt} format="relative" />
                  </span>
                  {session.impersonatedBy && <Badge variant="warning">impersonated</Badge>}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onRevokeSession(session.token)}
                  disabled={revokingToken === session.token}
                  data-testid={`admin-users.session-revoke-${session.id}`}
                >
                  {revokingToken === session.token ? <Spinner /> : null}
                  Revoke
                </Button>
              </div>
            ))
          )}
        </div>
        <DialogFooter>
          <Button
            variant="destructive"
            onClick={onRevokeAll}
            disabled={isRevokingAll || sessions.length === 0}
            data-testid="admin-users.sessions-revoke-all"
          >
            {isRevokingAll ? <Spinner /> : null}
            Revoke all
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
