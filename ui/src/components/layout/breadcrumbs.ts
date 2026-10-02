export interface Crumb {
  label: string;
  to?: string;
}

export interface CrumbContext {
  appName?: string;
  orgName?: (slug: string) => string | undefined;
  tab?: string;
}

const SETTINGS_SECTIONS: Record<string, string> = {
  profile: "Profile",
  "auth-methods": "Sign-in methods",
  "api-keys": "API keys",
  security: "Security",
};

const ADMIN_SECTIONS: Record<string, { label: string; detail: string }> = {
  nodes: { label: "Communities", detail: "Community" },
  proposals: { label: "Proposals", detail: "Proposal" },
  tenants: { label: "Sites", detail: "Site" },
  relayer: { label: "Relayer", detail: "Relayer" },
  system: { label: "System", detail: "System" },
};

const HOME: Crumb = { label: "Home", to: "/dashboard" };
const MY_COMMUNITY: Crumb = { label: "My community", to: "/dashboard/node" };
const EXPLORE: Crumb = { label: "Explore", to: "/explore" };
const ORGS: Crumb = { label: "Organizations", to: "/orgs" };
const THINGS: Crumb = { label: "Things", to: "/things" };
const ADMIN: Crumb = { label: "Admin", to: "/admin" };
const SETTINGS: Crumb = { label: "Settings", to: "/settings" };
const DOCS: Crumb = { label: "Docs", to: "/about" };

function humanize(segment: string) {
  const text = decodeURIComponent(segment).replace(/[-_]+/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function page(label: string): Crumb {
  return { label };
}

export function crumbsFor(pathname: string, context: CrumbContext = {}): Crumb[] {
  const segments = pathname.split("/").filter(Boolean);
  const [first, second, third, fourth, fifth] = segments;

  if (segments.length === 0) return [page(context.appName ?? "CityNode")];

  switch (first) {
    case "dashboard":
      if (second !== "node") return [page(HOME.label)];
      if (third === "proposals") {
        if (!fourth) return [MY_COMMUNITY, page("Proposals")];
        return [
          MY_COMMUNITY,
          { label: "Proposals", to: "/dashboard/node/proposals" },
          page("Proposal"),
        ];
      }
      return [page(MY_COMMUNITY.label)];
    case "nodes":
      if (third === "events" && second) {
        const events = { label: "Events & profile", to: `/nodes/${second}/content` };
        if (fourth === "new") return [MY_COMMUNITY, events, page("New event")];
        if (fifth === "edit") return [MY_COMMUNITY, events, page("Edit event")];
      }
      return [
        MY_COMMUNITY,
        page(
          context.tab === "onboarding"
            ? "Onboarding"
            : context.tab === "profile"
              ? "Profile"
              : "Events & profile",
        ),
      ];
    case "tenant":
      return [MY_COMMUNITY, page("Community settings")];
    case "explore":
      return [page(EXPLORE.label)];
    case "n":
      return second ? [EXPLORE, page(humanize(second))] : [page(EXPLORE.label)];
    case "activity":
      return [EXPLORE, page("Event")];
    case "stake":
      return [page("Stake")];
    case "apply":
      return [page("Start a community")];
    case "discover":
      return [page("Directory")];
    case "orgs": {
      if (!second) return [page(ORGS.label)];
      if (second === "new") return [ORGS, page("New organization")];
      if (second === "invites") return [ORGS, page("Invitation")];
      return [ORGS, page(context.orgName?.(second) ?? decodeURIComponent(second))];
    }
    case "things": {
      if (!second) return [page(THINGS.label)];
      if (second === "new") return [THINGS, page("New thing")];
      if (second === "live") return [THINGS, page("Live")];
      return [THINGS, page("Thing")];
    }
    case "admin": {
      const section = second ? ADMIN_SECTIONS[second] : undefined;
      if (!section) return [page(ADMIN.label)];
      if (!third) return [ADMIN, page(section.label)];
      const sectionCrumb = { label: section.label, to: `/admin/${second}` };
      if (fourth === "edit")
        return [
          ADMIN,
          sectionCrumb,
          { label: section.detail, to: `/admin/${second}/${third}` },
          page(`Edit ${section.detail.toLowerCase()}`),
        ];
      return [
        ADMIN,
        sectionCrumb,
        page(third === "new" ? `New ${section.detail.toLowerCase()}` : section.detail),
      ];
    }
    case "settings": {
      const section = second ? SETTINGS_SECTIONS[second] : undefined;
      return section ? [SETTINGS, page(section)] : [page(SETTINGS.label)];
    }
    case "about":
      return [page(DOCS.label)];
    case "skill":
      return [DOCS, page("Agent skill")];
    case "prototype-staking-poc":
      return [page("Node lifecycle")];
    case "login":
      return [page("Sign in")];
    case "onboard":
      return [page("Join")];
    case "onboarding":
      return [page("Onboarding station")];
    default:
      if (segments.length === 1) return [page(decodeURIComponent(first))];
      return segments.map((segment) => page(humanize(segment)));
  }
}
