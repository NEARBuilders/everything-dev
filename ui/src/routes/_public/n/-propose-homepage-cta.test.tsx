// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProposeHomepageCta } from "./-propose-homepage-cta";

const TENANT_ID = "00000000-0000-4000-8000-000000000276";

type TenantResult = { id: string; ownerKind: "platform" | "dao" } | Error | null;

const harness = vi.hoisted(() => ({
  session: null as unknown,
  orgs: [] as { id: string; slug: string }[],
  tenants: {} as Record<string, unknown>,
  listOrganizations: vi.fn(),
  resolveTenantByOrgId: vi.fn(),
}));

vi.mock("@/app", async () => ({
  ...(await vi.importActual<object>("@/app")),
  useApiClient: () => ({ resolveTenantByOrgId: harness.resolveTenantByOrgId }),
  useAuthClient: () => ({
    getSession: async () => ({ data: harness.session }),
    organization: { list: harness.listOrganizations },
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    search,
    children,
    ...rest
  }: {
    to: string;
    params: { slug: string };
    search: { tab: string };
    children?: ReactNode;
  }) => (
    <a href={`${to.replace("$slug", params.slug)}?tab=${search.tab}`} {...rest}>
      {children}
    </a>
  ),
}));

function setup(options: {
  signedIn: boolean;
  orgs?: { id: string; slug: string }[];
  tenants?: Record<string, TenantResult>;
}) {
  harness.session = options.signedIn ? { user: { id: "u1", isAnonymous: false } } : null;
  harness.listOrganizations.mockResolvedValue({ data: options.orgs ?? [] });
  harness.resolveTenantByOrgId.mockImplementation(async ({ orgId }: { orgId: string }) => {
    const result = options.tenants?.[orgId] ?? null;
    if (result instanceof Error) throw result;
    return result;
  });
}

function renderCta(tenantId: string | null = TENANT_ID) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProposeHomepageCta tenantId={tenantId} />
    </QueryClientProvider>,
  );
}

async function settle() {
  await waitFor(() => expect(harness.listOrganizations).toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve, 20));
}

beforeEach(() => {
  harness.listOrganizations.mockReset();
  harness.resolveTenantByOrgId.mockReset();
});

afterEach(cleanup);

describe("ProposeHomepageCta", () => {
  it("links an owning DAO organization member to the homepage tab", async () => {
    setup({
      signedIn: true,
      orgs: [{ id: "org-1", slug: "chicago-org" }],
      tenants: { "org-1": { id: TENANT_ID, ownerKind: "dao" } },
    });
    renderCta();

    const link = await screen.findByTestId("node-page.propose-homepage");
    expect(link.getAttribute("href")).toBe("/orgs/chicago-org?tab=homepage");
    expect(link.textContent).toContain("Propose homepage change");
  });

  it("stays hidden and queries nothing when signed out", async () => {
    setup({ signedIn: false });
    renderCta();

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.queryByTestId("node-page.propose-homepage")).toBeNull();
    expect(harness.listOrganizations).not.toHaveBeenCalled();
    expect(harness.resolveTenantByOrgId).not.toHaveBeenCalled();
  });

  it("stays hidden for an organization owning a different tenant", async () => {
    setup({
      signedIn: true,
      orgs: [{ id: "org-1", slug: "other" }],
      tenants: { "org-1": { id: "another-tenant", ownerKind: "dao" } },
    });
    renderCta();

    await settle();
    expect(screen.queryByTestId("node-page.propose-homepage")).toBeNull();
  });

  it("stays hidden for a platform-owned tenant", async () => {
    setup({
      signedIn: true,
      orgs: [{ id: "org-1", slug: "chicago-org" }],
      tenants: { "org-1": { id: TENANT_ID, ownerKind: "platform" } },
    });
    renderCta();

    await settle();
    expect(screen.queryByTestId("node-page.propose-homepage")).toBeNull();
  });

  it("stays hidden and queries nothing without a tenant id", async () => {
    setup({ signedIn: true, orgs: [{ id: "org-1", slug: "chicago-org" }] });
    renderCta(null);

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.queryByTestId("node-page.propose-homepage")).toBeNull();
    expect(harness.listOrganizations).not.toHaveBeenCalled();
  });

  it("stays hidden when the tenant lookup fails", async () => {
    setup({
      signedIn: true,
      orgs: [{ id: "org-1", slug: "chicago-org" }],
      tenants: { "org-1": new Error("boom") },
    });
    renderCta();

    await settle();
    expect(screen.queryByTestId("node-page.propose-homepage")).toBeNull();
  });
});
