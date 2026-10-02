import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/app";
import {
  buildNodeProposalPayload,
  canSubmitNodeApplication,
  generateNodeApplicationSlug,
  getDefaultOrganizationId,
  nodeApplicationSchema,
  parseNodeProposalPayload,
  proposeNodeApplication,
  resolveActiveOrganizationLabel,
} from "./-node-application";

describe("node application", () => {
  it("requires the correct parent for each node kind", () => {
    const base = {
      name: "Chicago",
      slug: "chicago",
      motivation: "I want to operate a node for the local community.",
    };

    expect(
      nodeApplicationSchema.safeParse({ ...base, kind: "country", parentId: null }).success,
    ).toBe(true);
    expect(
      nodeApplicationSchema.safeParse({ ...base, kind: "state", parentId: null }).success,
    ).toBe(false);
    expect(
      nodeApplicationSchema.safeParse({ ...base, kind: "city", parentId: "state-id" }).success,
    ).toBe(true);
  });

  it("always derives the slug from the node name", () => {
    expect(generateNodeApplicationSlug("Chicago")).toBe("chicago");
    expect(generateNodeApplicationSlug("Chicago Heights")).toBe("chicago-heights");
  });

  it("builds the agreed node proposal payload", () => {
    expect(
      buildNodeProposalPayload(
        {
          kind: "city",
          parentId: "state-id",
          name: "Chicago",
          slug: "chicago",
          motivation: "I want to operate a node for the local community.",
        },
        {
          orgId: "org-1",
          daoAccountId: "chicago.sputnik-dao.near",
          submitterAccountId: "applicant.near",
        },
      ),
    ).toEqual({
      kind: "city",
      parentId: "state-id",
      name: "Chicago",
      slug: "chicago",
      orgId: "org-1",
      motivation: "I want to operate a node for the local community.",
      accountId: "chicago.sputnik-dao.near",
      submitterAccountId: "applicant.near",
    });
  });

  it("rejects malformed stored proposal payloads", () => {
    expect(() => parseNodeProposalPayload({ kind: "city", slug: "Chicago" })).toThrow();
  });

  it("shows the active organization name instead of its internal ID", () => {
    const activeOrgId = "94aa90a1-40f7-479f-ad02-a4a8c031f2aa";
    expect(
      resolveActiveOrganizationLabel(activeOrgId, [{ id: activeOrgId, name: "Zeeshan" }]),
    ).toBe("Zeeshan");
    expect(resolveActiveOrganizationLabel(activeOrgId, [])).toBe("Active organization");
  });

  it("selects the first organization only when none is active", () => {
    const organizations = [
      { id: "org-1", name: "Default organization" },
      { id: "org-2", name: "Another organization" },
    ];

    expect(getDefaultOrganizationId(null, organizations)).toBe("org-1");
    expect(getDefaultOrganizationId("org-2", organizations)).toBeNull();
    expect(getDefaultOrganizationId(null, [])).toBeNull();
  });

  it("submits the exact node proposal envelope", async () => {
    const propose = vi.fn().mockResolvedValue({ data: { id: "proposal-id" } });
    await proposeNodeApplication(
      { proposals: { propose } } as unknown as ApiClient,
      {
        kind: "city",
        parentId: "state-id",
        name: "Chicago",
        slug: "chicago",
        motivation: "I want to operate a node for the local community.",
      },
      {
        orgId: "org-1",
        daoAccountId: "chicago.sputnik-dao.near",
        submitterAccountId: "applicant.near",
      },
    );

    expect(propose).toHaveBeenCalledWith({
      pluginId: "node",
      entityId: "chicago",
      source: "/apply",
      payload: {
        kind: "city",
        parentId: "state-id",
        name: "Chicago",
        slug: "chicago",
        orgId: "org-1",
        motivation: "I want to operate a node for the local community.",
        accountId: "chicago.sputnik-dao.near",
        submitterAccountId: "applicant.near",
      },
    });
  });

  it("requires identity, valid values, and an available hostname before submission", () => {
    const values = {
      kind: "country" as const,
      parentId: null,
      name: "Canada",
      slug: "canada",
      motivation: "I want to operate a country node.",
    };
    expect(
      canSubmitNodeApplication({
        values,
        orgId: "org-1",
        daoAccountId: "chicago.sputnik-dao.near",
        submitterAccountId: "applicant.near",
        hostnameAvailable: true,
      }),
    ).toBe(true);
    expect(
      canSubmitNodeApplication({
        values,
        orgId: null,
        daoAccountId: "chicago.sputnik-dao.near",
        submitterAccountId: "applicant.near",
        hostnameAvailable: true,
      }),
    ).toBe(false);
    expect(
      canSubmitNodeApplication({
        values,
        orgId: "org-1",
        daoAccountId: null,
        submitterAccountId: "applicant.near",
        hostnameAvailable: true,
      }),
    ).toBe(false);
    expect(
      canSubmitNodeApplication({
        values,
        orgId: "org-1",
        daoAccountId: "chicago.sputnik-dao.near",
        submitterAccountId: null,
        hostnameAvailable: true,
      }),
    ).toBe(false);
    expect(
      canSubmitNodeApplication({
        values,
        orgId: "org-1",
        daoAccountId: "chicago.sputnik-dao.near",
        submitterAccountId: "applicant.near",
        hostnameAvailable: false,
      }),
    ).toBe(false);
  });
});
