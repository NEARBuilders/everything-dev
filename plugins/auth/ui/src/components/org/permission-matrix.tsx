import { CheckIcon, MinusIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { permissionRegistryQueryKey } from "@/lib/org-query-keys";
import { useAuthApi } from "@/lib/use-auth-api";
import { roleLabel } from "./org-avatar";

const ROLE_ORDER = ["owner", "admin", "member"];

export function usePermissionRegistry() {
  const api = useAuthApi();
  return useQuery({
    queryKey: permissionRegistryQueryKey,
    queryFn: () => api.getPermissionRegistry(),
    staleTime: 5 * 60 * 1000,
  });
}

export function PermissionMatrix() {
  const registry = usePermissionRegistry();

  if (registry.isPending) return <Skeleton className="h-48 w-full rounded-2xl" />;
  if (registry.isError) {
    return <p className="text-sm text-muted-foreground">Couldn't load role permissions.</p>;
  }

  const { statements, roles } = registry.data;
  const roleNames = [
    ...ROLE_ORDER.filter((role) => role in roles),
    ...Object.keys(roles).filter((role) => !ROLE_ORDER.includes(role)),
  ];
  const rows = Object.entries(statements).flatMap(([resource, actions]) =>
    actions.map((action) => ({ resource, action })),
  );

  return (
    <div
      className="overflow-x-auto rounded-2xl border border-border"
      data-testid="org-permission-matrix"
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Permission</TableHead>
            {roleNames.map((role) => (
              <TableHead key={role} className="text-center">
                {roleLabel(role)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ resource, action }) => (
            <TableRow key={`${resource}:${action}`}>
              <TableCell>
                <span className="font-medium">{resource}</span>
                <span className="text-muted-foreground"> · {action}</span>
              </TableCell>
              {roleNames.map((role) => {
                const granted = roles[role]?.[resource]?.includes(action) ?? false;
                return (
                  <TableCell key={role} className="text-center">
                    {granted ? (
                      <CheckIcon
                        className="mx-auto size-4 text-foreground"
                        aria-label={`${roleLabel(role)} can ${action} ${resource}`}
                      />
                    ) : (
                      <MinusIcon
                        className="mx-auto size-4 text-muted-foreground/50"
                        aria-label={`${roleLabel(role)} cannot ${action} ${resource}`}
                      />
                    )}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
