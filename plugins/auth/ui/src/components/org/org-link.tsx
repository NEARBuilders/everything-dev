import { Link } from "@tanstack/react-router";
import type { ComponentPropsWithRef } from "react";
import { useOrgWorkspace } from "./workspace-context";

export type OrgTarget =
  | { to: "overview" | "members" | "teams" | "invitations" | "api-keys" }
  | { to: "team"; teamId: string };

type OrgLinkProps = Omit<ComponentPropsWithRef<"a">, "href"> & { section: OrgTarget };

export function OrgLink({ section, ...props }: OrgLinkProps) {
  const { mode, reference } = useOrgWorkspace();

  if (mode === "admin") {
    const params = { orgId: reference };
    switch (section.to) {
      case "overview":
        return <Link to="/admin/orgs/$orgId" params={params} {...props} />;
      case "members":
        return <Link to="/admin/orgs/$orgId/members" params={params} {...props} />;
      case "teams":
        return <Link to="/admin/orgs/$orgId/teams" params={params} {...props} />;
      case "team":
        return (
          <Link
            to="/admin/orgs/$orgId/teams/$teamId"
            params={{ ...params, teamId: section.teamId }}
            {...props}
          />
        );
      case "invitations":
        return <Link to="/admin/orgs/$orgId/invitations" params={params} {...props} />;
      case "api-keys":
        return <Link to="/admin/orgs/$orgId" params={params} {...props} />;
    }
  }

  const params = { slug: reference };
  switch (section.to) {
    case "overview":
      return <Link to="/orgs/$slug" params={params} {...props} />;
    case "members":
      return <Link to="/orgs/$slug/members" params={params} {...props} />;
    case "teams":
      return <Link to="/orgs/$slug/teams" params={params} {...props} />;
    case "team":
      return (
        <Link
          to="/orgs/$slug/teams/$teamId"
          params={{ ...params, teamId: section.teamId }}
          {...props}
        />
      );
    case "invitations":
      return <Link to="/orgs/$slug/invitations" params={params} {...props} />;
    case "api-keys":
      return <Link to="/orgs/$slug/api-keys" params={params} {...props} />;
  }
}
