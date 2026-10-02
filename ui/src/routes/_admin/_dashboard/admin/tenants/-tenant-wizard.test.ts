import { FormApi } from "@tanstack/react-form";
import { describe, expect, it, vi } from "vitest";
import {
  classifyTenantKey,
  deriveTenantWizardNameFields,
  filterTenants,
  generateSlug,
  type NearNetworkId,
  resolveOrgSlug,
  resolvePrimaryHostname,
  resolveTenantDeploySteps,
  resolveTenantWizardSteps,
  type TenantWizardValues,
  tenantWizardSchema,
} from "./-tenant-wizard";

describe("tenantWizardSchema", () => {
  const validValues = {
    kind: "country" as const,
    parentId: "",
    name: "Chicago",
    slug: "chicago",
    tenantName: "Chicago",
  };

  it("accepts a country without a parent", () => {
    expect(tenantWizardSchema.safeParse(validValues).success).toBe(true);
  });

  it.each(["state", "city"] as const)("requires a parent for a %s", (kind) => {
    const result = tenantWizardSchema.safeParse({ ...validValues, kind });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({ path: ["parentId"], message: "parent is required" }),
      );
    }
  });

  it("rejects blank names and invalid slugs", () => {
    const result = tenantWizardSchema.safeParse({
      ...validValues,
      name: "  ",
      slug: "Chicago City",
      tenantName: "  ",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path[0])).toEqual([
        "name",
        "slug",
        "tenantName",
      ]);
    }
  });

  it("blocks submission when the form values are invalid", async () => {
    const onSubmit = vi.fn();
    const defaultValues: TenantWizardValues = {
      kind: "city",
      parentId: "",
      name: "",
      slug: "",
      tenantName: "",
    };
    const form = new FormApi({
      defaultValues,
      validators: { onSubmit: tenantWizardSchema },
      onSubmit,
    });
    const cleanup = form.mount();

    await form.handleSubmit();

    expect(onSubmit).not.toHaveBeenCalled();
    cleanup();
  });
});

describe("tenant wizard name derivation", () => {
  it("generates a normalized slug", () => {
    expect(generateSlug(" Chicago City Node ")).toBe("chicago-city-node");
  });

  it("keeps slug and tenant name in sync while they are untouched", () => {
    let current = { slug: "", tenantName: "" };

    for (const name of ["C", "Ch", "Chi", "Chicago"]) {
      current = deriveTenantWizardNameFields(name, current, {
        slug: false,
        tenantName: false,
      });
    }

    expect(current).toEqual({ slug: "chicago", tenantName: "Chicago" });
  });

  it("stops syncing each manually edited field independently", () => {
    const current = { slug: "chi-town", tenantName: "Chicago" };
    const slugEdited = deriveTenantWizardNameFields("Chicago City", current, {
      slug: true,
      tenantName: false,
    });

    expect(slugEdited).toEqual({ slug: "chi-town", tenantName: "Chicago City" });

    const bothEdited = deriveTenantWizardNameFields(
      "Chicago City Node",
      { ...slugEdited, tenantName: "Windy City" },
      { slug: true, tenantName: true },
    );

    expect(bothEdited).toEqual({ slug: "chi-town", tenantName: "Windy City" });
  });
});

describe("classifyTenantKey", () => {
  it("classifies tenant UUIDs", () => {
    expect(classifyTenantKey("6e8c1159-97ec-43bd-ae4a-56ecc492edfa")).toBe("uuid");
    expect(classifyTenantKey("6E8C1159-97EC-43BD-AE4A-56ECC492EDFA")).toBe("uuid");
  });

  it("classifies NEAR account ids by their dot segments", () => {
    expect(classifyTenantKey("testing123.sputnik-dao.near")).toBe("accountId");
    expect(classifyTenantKey("chicago.v1.citynode.near")).toBe("accountId");
  });

  it("classifies bare directory slugs", () => {
    expect(classifyTenantKey("test")).toBe("slug");
    expect(classifyTenantKey("chicago")).toBe("slug");
  });
});

describe("resolvePrimaryHostname", () => {
  it("prefers the primary binding's hostname", () => {
    expect(
      resolvePrimaryHostname([
        { hostname: "fallback.citynode.app", isPrimary: false },
        { hostname: "test.citynode.app", isPrimary: true },
      ]),
    ).toBe("test.citynode.app");
  });

  it("falls back to the first binding with a hostname", () => {
    expect(
      resolvePrimaryHostname([
        { hostname: "", isPrimary: true },
        { hostname: "only.citynode.app", isPrimary: false },
      ]),
    ).toBe("only.citynode.app");
  });

  it("returns null for empty, missing, or hostname-less inputs", () => {
    expect(resolvePrimaryHostname(null)).toBeNull();
    expect(resolvePrimaryHostname(undefined)).toBeNull();
    expect(resolvePrimaryHostname([])).toBeNull();
    expect(resolvePrimaryHostname([{ hostname: "", isPrimary: true }])).toBeNull();
  });
});

describe("resolveOrgSlug", () => {
  const orgs = [
    { id: "org-1", slug: "test" },
    { id: "org-2", slug: "chicago" },
    { id: "org-3", slug: null },
  ];

  it("matches the org id and returns its slug", () => {
    expect(resolveOrgSlug(orgs, "org-1")).toBe("test");
    expect(resolveOrgSlug(orgs, "org-2")).toBe("chicago");
  });

  it("returns null for unknown orgs, missing slugs, or missing inputs", () => {
    expect(resolveOrgSlug(orgs, "org-3")).toBeNull();
    expect(resolveOrgSlug(orgs, "nope")).toBeNull();
    expect(resolveOrgSlug(orgs, null)).toBeNull();
    expect(resolveOrgSlug(null, "org-1")).toBeNull();
    expect(resolveOrgSlug(undefined, undefined)).toBeNull();
  });
});

describe("NearNetworkId", () => {
  it("is a mainnet/testnet union usable at runtime", () => {
    const networks: NearNetworkId[] = ["mainnet", "testnet"];
    expect(networks).toHaveLength(2);
  });
});

describe("resolveTenantWizardSteps", () => {
  it("opens the first unfinished step and collapses finished ones", () => {
    const steps = resolveTenantWizardSteps({ organization: true, dao: false, details: false });
    expect(steps.current).toBe("dao");
    expect(steps.position).toBe(2);
    expect(steps.status("organization")).toBe("complete");
    expect(steps.status("dao")).toBe("current");
    expect(steps.status("details")).toBe("upcoming");
    expect(steps.status("review")).toBe("upcoming");
  });

  it("reopens the DAO step when the DAO disconnects after details are done", () => {
    const steps = resolveTenantWizardSteps({ organization: true, dao: false, details: true });
    expect(steps.current).toBe("dao");
    expect(steps.status("details")).toBe("complete");
  });

  it("lands on review once every prerequisite is done", () => {
    const steps = resolveTenantWizardSteps({ organization: true, dao: true, details: true });
    expect(steps.current).toBe("review");
    expect(steps.position).toBe(4);
  });

  it("always starts with the organization when none is active", () => {
    expect(
      resolveTenantWizardSteps({ organization: false, dao: true, details: true }).current,
    ).toBe("organization");
  });
});

describe("resolveTenantDeploySteps", () => {
  it("asks to publish once records exist", () => {
    expect(
      resolveTenantDeploySteps({ create: "success", publish: "pending", verified: false }),
    ).toEqual({ create: "complete", publish: "current", live: "upcoming" });
  });

  it("surfaces a failed publish", () => {
    expect(
      resolveTenantDeploySteps({ create: "success", publish: "failed", verified: false }),
    ).toEqual({ create: "complete", publish: "failed", live: "upcoming" });
  });

  it("waits for DAO approval after submitting and completes when verified", () => {
    expect(
      resolveTenantDeploySteps({ create: "success", publish: "success", verified: false }).live,
    ).toBe("current");
    expect(
      resolveTenantDeploySteps({ create: "success", publish: "success", verified: true }),
    ).toEqual({ create: "complete", publish: "complete", live: "complete" });
  });

  it("holds later steps while records are being created or failed", () => {
    expect(
      resolveTenantDeploySteps({ create: "failed", publish: "pending", verified: false }),
    ).toEqual({ create: "failed", publish: "upcoming", live: "upcoming" });
  });
});

describe("filterTenants", () => {
  const tenants = [
    { id: "t1", name: "Chicago", accountId: "chicago.sputnik-dao.near", status: "active" },
    { id: "t2", name: "Lahore", accountId: "lhr.sputnik-dao.near", status: "pending_deletion" },
    { id: "t3", name: "Berlin", accountId: "berlin.near", status: "suspended" },
  ];

  it("filters by status, folding pending deletion into pending", () => {
    expect(filterTenants(tenants, { status: "pending", query: "" }).map((t) => t.id)).toEqual([
      "t2",
    ]);
    expect(filterTenants(tenants, { status: "all", query: "" })).toHaveLength(3);
  });

  it("searches name, DAO account and node slug", () => {
    const slugs = new Map([["t3", "ber"]]);
    expect(filterTenants(tenants, { status: "all", query: "sputnik" }).map((t) => t.id)).toEqual([
      "t1",
      "t2",
    ]);
    expect(
      filterTenants(tenants, { status: "all", query: "BER", slugByTenantId: slugs }).map(
        (t) => t.id,
      ),
    ).toEqual(["t3"]);
  });
});
