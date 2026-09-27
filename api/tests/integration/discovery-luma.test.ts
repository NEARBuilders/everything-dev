import { Effect } from "effect";
import { afterAll, afterEach, expect, it, vi } from "vitest";
import { authedContext, daoContext, getPluginClient, orgContext, teardown } from "../setup";

vi.mock("@/services/dao", () => ({
  verifyDaoMembership: vi.fn(() =>
    Effect.succeed({ isSputnikContract: true, isMember: true, policy: { roles: [] } }),
  ),
  parsePolicyGroupMembers: vi.fn(() => []),
  isExplicitDaoMember: vi.fn(() => true),
}));
vi.mock("../../plugin.dev", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../plugin.dev")>();
  return {
    default: {
      ...original.default,
      config: {
        ...original.default.config,
        secrets: { ...original.default.config.secrets, LUMA_CALENDAR_API_KEYS: "fixture-key" },
      },
    },
  };
});
afterEach(() => vi.unstubAllGlobals());
afterAll(teardown);
it("connects a Luma calendar and automatically publishes and updates its public events", async () => {
  const realFetch = globalThis.fetch;
  let title = "Luma builders meetup";
  let visibility = "public";
  let partialFailure = false;
  vi.stubGlobal("fetch", async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== "https://public-api.luma.com") return realFetch(input, init);
    expect(new Headers(init?.headers).get("x-luma-api-key")).toBe("fixture-key");
    if (url.searchParams.has("pagination_cursor") && partialFailure)
      return new Response("Rate limited", { status: 429 });
    return Response.json(
      url.pathname === "/v1/calendars/get"
        ? { id: "cal-fixture", name: "Builders", url: "https://luma.com/builders" }
        : {
            entries: [
              {
                id: "evt-fixture",
                platform: "luma",
                name: title,
                url: "https://luma.com/meetup",
                start_at: "2027-01-01T12:00:00Z",
                end_at: "2027-01-01T14:00:00Z",
                created_at: "2026-09-01T12:00:00Z",
                timezone: "UTC",
                visibility,
                location_visibility: "guests-only",
                geo_address_json: { full_address: "Private guest address", city_state: null },
              },
            ],
            has_more: partialFailure,
            next_cursor: partialFailure ? "page-2" : undefined,
          },
    );
  });
  const provisioner = await getPluginClient(daoContext("luma-owner", "luma-org", "luma.near"));
  const tenant = await provisioner.createTenant({ name: "Luma node", accountId: "luma.near" });
  const node = await provisioner.createNode({
    name: "Luma city",
    slug: "luma-city",
    kind: "city",
    tenantId: tenant.id,
  });
  const editor = await getPluginClient(orgContext("luma-owner", "luma-org"));
  await editor.saveDiscoveryProfile({
    nodeId: node.id,
    summary: "Luma community",
    location: "",
    region: "",
    latitude: null,
    longitude: null,
    channels: [],
    published: true,
  });
  const publicClient = await getPluginClient();
  const member = await getPluginClient(orgContext("ordinary", "luma-org", "member"));
  await expect(
    member.importDiscoveryLuma({ nodeId: node.id, calendarId: "cal-fixture" }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(await editor.listDiscoveryLumaCalendars({ nodeId: node.id })).toMatchObject({
    calendars: [{ id: "cal-fixture", name: "Builders" }],
  });
  expect(
    await editor.importDiscoveryLuma({ nodeId: node.id, calendarId: "cal-fixture" }),
  ).toMatchObject({ imported: 1, updated: 0 });
  const [first] = await editor.listDiscoveryActivities({ nodeId: node.id });
  expect(first).toMatchObject({
    title,
    status: "published",
    source: "Luma · Builders",
    venue: "See Luma for location details",
    luma: { eventId: "evt-fixture", calendarId: "cal-fixture" },
  });
  expect(JSON.stringify(first)).not.toContain("Private guest address");
  expect(await editor.listDiscoveryLumaCalendars({ nodeId: node.id })).toMatchObject({
    connection: { calendarId: "cal-fixture" },
  });
  expect(await publicClient.getDiscoveryActivity({ id: first!.id })).toMatchObject({
    status: "published",
  });
  title = "Updated in Luma";
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 6 * 60_000);
  await publicClient.listDiscovery({});
  await expect
    .poll(async () => (await publicClient.getDiscoveryActivity({ id: first!.id }))?.title)
    .toBe(title);
  clock.mockRestore();
  const refreshed = await editor.listDiscoveryActivities({ nodeId: node.id });
  expect(refreshed).toHaveLength(1);
  expect(refreshed[0]).toMatchObject({ id: first!.id, title, status: "published" });
  await expect(
    editor.saveDiscoveryActivity({ ...refreshed[0]!, title: "Local override" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await editor.saveDiscoveryActivity({
    ...refreshed[0]!,
    id: undefined,
    url: "https://example.com/manual-event",
    title: "Manual meetup",
  });
  partialFailure = true;
  await expect(
    editor.importDiscoveryLuma({ nodeId: node.id, calendarId: "cal-fixture" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(
    (await editor.listDiscoveryActivities({ nodeId: node.id })).find((a) => a.id === first!.id),
  ).toMatchObject({ title, status: "published" });
  partialFailure = false;
  visibility = "invalid-provider-value";
  await expect(
    editor.importDiscoveryLuma({ nodeId: node.id, calendarId: "cal-fixture" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(
    (await editor.listDiscoveryActivities({ nodeId: node.id })).find((a) => a.id === first!.id),
  ).toMatchObject({ status: "published" });
  visibility = "private";
  expect(
    await editor.importDiscoveryLuma({ nodeId: node.id, calendarId: "cal-fixture" }),
  ).toMatchObject({ withdrawn: 1 });
  const withdrawn = (await editor.listDiscoveryActivities({ nodeId: node.id })).find(
    (a) => a.id === first!.id,
  )!;
  expect(withdrawn).toMatchObject({ status: "draft", luma: { available: false } });
  await expect(
    editor.saveDiscoveryActivity({ ...withdrawn, status: "published" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(
    editor.saveDiscoveryActivity({ ...withdrawn, status: "cancelled" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await (await getPluginClient()).getDiscoveryActivity({ id: withdrawn.id })).toBeNull();
  visibility = "public";
  await editor.importDiscoveryLuma({ nodeId: node.id, calendarId: "cal-fixture" });
  const final = await editor.listDiscoveryActivities({ nodeId: node.id });
  expect(final.find((a) => a.id === first!.id)).toMatchObject({
    status: "published",
    luma: { available: true },
  });
  expect(final.find((a) => a.title === "Manual meetup")).toMatchObject({ status: "published" });
  const otherNode = await provisioner.createNode({
    name: "Second Luma city",
    slug: "second-luma-city",
    kind: "city",
    tenantId: tenant.id,
  });
  await editor.importDiscoveryLuma({ nodeId: otherNode.id, calendarId: "cal-fixture" });
  expect(await editor.listDiscoveryActivities({ nodeId: otherNode.id })).toEqual(
    expect.arrayContaining([expect.objectContaining({ title, status: "published" })]),
  );
  const admin = await getPluginClient(authedContext("luma-admin", "admin"));
  await publicClient.reportDiscoveryContent({
    targetId: first!.id,
    kind: "activity",
    token: crypto.randomUUID(),
    reason: "This event should be hidden",
  });
  const report = (await admin.getDiscoveryStudio()).reports.find(
    (report) => report.targetId === first!.id,
  )!;
  await admin.moderateDiscoveryReport({
    reportId: report.id,
    action: "unpublish",
    note: "Hidden by admin",
  });
  await editor.importDiscoveryLuma({ nodeId: node.id, calendarId: "cal-fixture" });
  expect(await publicClient.getDiscoveryActivity({ id: first!.id })).toBeNull();
  const beforeWithdrawal = final.find((a) => a.id === first!.id)!;
  visibility = "private";
  const races = await Promise.allSettled([
    editor.importDiscoveryLuma({ nodeId: node.id, calendarId: "cal-fixture" }),
    ...Array.from({ length: 5 }, () =>
      editor.saveDiscoveryActivity({ ...beforeWithdrawal, status: "published" }),
    ),
  ]);
  expect(races[0]!.status).toBe("fulfilled");
  expect(
    (await editor.listDiscoveryActivities({ nodeId: node.id })).find((a) => a.id === first!.id),
  ).toMatchObject({ status: "draft", luma: { available: false } });
  expect(await publicClient.getDiscoveryActivity({ id: first!.id })).toBeNull();
  await editor.disconnectDiscoveryLuma({ nodeId: node.id });
  expect(await editor.listDiscoveryLumaCalendars({ nodeId: node.id })).toMatchObject({
    connection: null,
  });
  expect(
    (await editor.listDiscoveryActivities({ nodeId: node.id })).find(
      (a) => a.title === "Manual meetup",
    ),
  ).toMatchObject({ status: "published" });
});
