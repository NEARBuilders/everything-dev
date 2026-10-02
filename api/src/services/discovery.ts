import { ORPCError } from "@orpc/server";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { Clock, Context, DateTime, Effect, Layer, Schedule } from "effect";
import type { Database } from "../db";
import { DatabaseTag } from "../db/layer";
import {
  discoveryActivities,
  discoveryCurators,
  discoveryFeatures,
  discoveryHistory,
  discoveryLumaConnections,
  discoveryMeasurements,
  discoveryProfiles,
  discoveryReports,
  nodes,
  tenants,
} from "../db/schema";
import type {
  DiscoveryActivity,
  DiscoveryMeasurement,
  DiscoveryProfile,
} from "../discovery-contract";
import type { AuthPluginContext as AuthContext } from "../lib/auth-types.gen";
import { toOrpcError } from "../lib/errors";
import { type GeocodeService, GeocodeTag, shouldGeocodeProfile } from "./discovery-geocode";
import { createLumaCalendars } from "./discovery-luma";
import { nodeKindOf } from "./nodes";

export type DiscoveryEffect<T> = Effect.Effect<T, ORPCError<string, unknown>>;

function canonicalActivityUrl(value: string) {
  const url = new URL(value);
  url.hash = "";
  if (["lu.ma", "www.lu.ma", "www.luma.com"].includes(url.hostname)) url.hostname = "luma.com";
  for (const key of url.searchParams.keys())
    if (key.startsWith("utm_") || key === "fbclid") url.searchParams.delete(key);
  url.searchParams.sort();
  return url.toString();
}

function createDiscovery(db: Database, lumaKeys: string, geocode: GeocodeService) {
  const luma = createLumaCalendars(lumaKeys);

  const query = <T>(run: () => Promise<T>): DiscoveryEffect<T> =>
    Effect.tryPromise({ try: run, catch: toOrpcError });

  function requireAdmin(context: AuthContext): DiscoveryEffect<void> {
    if (!context.userId || !context.user) return Effect.fail(new ORPCError("UNAUTHORIZED"));
    if (context.user.role !== "admin") return Effect.fail(new ORPCError("FORBIDDEN"));
    return Effect.void;
  }

  function authorize(nodeId: string, context: AuthContext) {
    return Effect.gen(function* () {
      if (!context.userId || !context.user) {
        return yield* Effect.fail(new ORPCError("UNAUTHORIZED"));
      }
      const [record] = yield* query(() =>
        db
          .select({ node: nodes, tenant: tenants })
          .from(nodes)
          .innerJoin(tenants, eq(nodes.tenantId, tenants.id))
          .where(eq(nodes.id, nodeId)),
      );
      if (!record) {
        return yield* Effect.fail(new ORPCError("NOT_FOUND"));
      }
      if (context.user.role === "admin") return record;
      const org = context.organization;
      if (
        !record.tenant.orgId ||
        org?.activeOrganizationId !== record.tenant.orgId ||
        !["owner", "admin"].includes(org.member?.role ?? "")
      ) {
        return yield* Effect.fail(new ORPCError("FORBIDDEN"));
      }
      return record;
    });
  }

  function requireCurator(context: AuthContext): DiscoveryEffect<void> {
    return Effect.gen(function* () {
      if (!context.userId || !context.user) {
        return yield* Effect.fail(new ORPCError("UNAUTHORIZED"));
      }
      if (context.user.role === "admin") return;
      const userId = context.userId;
      const [grant] = yield* query(() =>
        db.select().from(discoveryCurators).where(eq(discoveryCurators.userId, userId)),
      );
      if (!grant) {
        return yield* Effect.fail(new ORPCError("FORBIDDEN"));
      }
    });
  }

  function eligibleProfiles(ids?: string[]) {
    return Effect.gen(function* () {
      if (ids?.length === 0) return [];
      return yield* query(() =>
        db
          .select({ profile: discoveryProfiles.data, node: nodes })
          .from(discoveryProfiles)
          .innerJoin(nodes, eq(discoveryProfiles.nodeId, nodes.id))
          .innerJoin(tenants, eq(nodes.tenantId, tenants.id))
          .where(
            and(
              eq(tenants.status, "active"),
              sql`${discoveryProfiles.data}->>'published' = 'true'`,
              ids ? inArray(nodes.id, ids) : undefined,
            ),
          ),
      );
    });
  }

  function eligibleProfile(nodeId: string | null) {
    return Effect.gen(function* () {
      if (!nodeId) return null;
      const rows = yield* eligibleProfiles([nodeId]);
      return rows[0]?.profile ?? null;
    });
  }

  function activityById(id: string) {
    return Effect.gen(function* () {
      const [row] = yield* query(() =>
        db.select().from(discoveryActivities).where(eq(discoveryActivities.id, id)),
      );
      return row?.data ?? null;
    });
  }

  function publicActivity(id: string) {
    return Effect.gen(function* () {
      const activity = yield* activityById(id);
      if (
        !activity ||
        activity.status === "draft" ||
        activity.luma?.available === false ||
        Date.parse(activity.publishedAt) > (yield* Clock.currentTimeMillis) ||
        !(yield* eligibleProfile(activity.ownerNodeId))
      ) {
        return null;
      }
      const eligible = new Set((yield* eligibleProfiles(activity.nodeIds)).map((r) => r.node.id));
      return { ...activity, nodeIds: activity.nodeIds.filter((id) => eligible.has(id)) };
    });
  }

  function list(input: {
    query?: string;
    region?: string;
    active?: boolean;
    upcoming?: boolean;
    nodeId?: string;
  }) {
    return Effect.gen(function* () {
      yield* Effect.forkDetach(syncDueLuma);
      const rows = yield* eligibleProfiles(input.nodeId ? [input.nodeId] : undefined);
      const activityRows = yield* query(() =>
        db
          .select({ data: discoveryActivities.data })
          .from(discoveryActivities)
          .innerJoin(
            discoveryProfiles,
            eq(discoveryActivities.ownerNodeId, discoveryProfiles.nodeId),
          )
          .innerJoin(nodes, eq(nodes.id, discoveryProfiles.nodeId))
          .innerJoin(tenants, eq(nodes.tenantId, tenants.id))
          .where(
            and(
              eq(tenants.status, "active"),
              sql`${discoveryProfiles.data}->>'published' = 'true'`,
              sql`${discoveryActivities.data}->>'status' = 'published'`,
              sql`(${discoveryActivities.data}->>'publishedAt')::timestamptz <= ${new Date(Date.now()).toISOString()}`,
              input.nodeId
                ? sql`${discoveryActivities.data}->'nodeIds' ? ${input.nodeId}`
                : undefined,
            ),
          ),
      );
      const activities = activityRows.map((r) => r.data);
      const eligible = new Set(
        (input.nodeId
          ? yield* eligibleProfiles([...new Set(activities.flatMap((a) => a.nodeIds))])
          : rows
        ).map((r) => r.node.id),
      );
      const byNode = new Map<string, DiscoveryActivity[]>();
      for (const activity of activities)
        for (const id of activity.nodeIds) {
          const group = byNode.get(id) ?? [];
          group.push(activity);
          byNode.set(id, group);
        }
      const now = yield* Clock.currentTimeMillis;
      const features = yield* query(() =>
        db
          .select()
          .from(discoveryFeatures)
          .where(
            and(
              gte(discoveryFeatures.expiresAt, DateTime.toDateUtc(DateTime.makeUnsafe(now))),
              input.nodeId ? eq(discoveryFeatures.nodeId, input.nodeId) : undefined,
            ),
          ),
      );
      const featureLabels = new Map(features.map((f) => [f.nodeId, f.label]));
      const day = 86_400_000;
      return rows
        .filter(
          ({ profile, node }) =>
            profile.published &&
            (!input.query ||
              `${node.name} ${profile.location}`
                .toLowerCase()
                .includes(input.query.toLowerCase())) &&
            (!input.region || profile.region === input.region),
        )
        .map(({ profile, node }) => {
          const content = byNode.get(node.id) ?? [];
          const events = content
            .filter((a) => a.kind === "event" && Date.parse(a.endsAt!) >= now)
            .sort((a, b) => a.startsAt!.localeCompare(b.startsAt!));
          const updates = content
            .filter((a) => a.kind === "social")
            .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
          const upcoming = events.some((a) => Date.parse(a.startsAt!) <= now + 60 * day);
          const recent =
            updates.some((a) => Date.parse(a.publishedAt) >= now - 30 * day) ||
            content.some(
              (a) =>
                a.kind === "event" &&
                Date.parse(a.endsAt!) >= now - 30 * day &&
                Date.parse(a.startsAt!) <= now,
            );
          return {
            ...profile,
            featured: featureLabels.get(node.id) ?? null,
            active: upcoming || recent,
            upcoming,
            activityReason: upcoming
              ? "Upcoming event"
              : recent
                ? "Recently active"
                : "Quiet lately",
            events: events
              .slice(0, 3)
              .map((a) => ({ ...a, nodeIds: a.nodeIds.filter((id) => eligible.has(id)) })),
            updates: updates.slice(0, 3),
            name: node.name,
            slug: node.slug,
            parentId: node.parentId,
            kind: nodeKindOf(node.metadata),
          };
        })
        .filter((p) => (!input.active || p.active) && (!input.upcoming || p.upcoming))
        .sort((a, b) => a.name.localeCompare(b.name) || a.nodeId.localeCompare(b.nodeId));
    });
  }

  function saveActivity(
    input: Omit<DiscoveryActivity, "id" | "luma"> & { id?: string },
    context: AuthContext,
  ) {
    return Effect.gen(function* () {
      const initial = input.id ? yield* activityById(input.id) : null;
      if (input.id && !initial) {
        return yield* Effect.fail(new ORPCError("NOT_FOUND"));
      }
      yield* authorize(initial?.ownerNodeId ?? input.ownerNodeId, context);
      for (const nodeId of new Set(input.nodeIds)) {
        if (!initial?.nodeIds.includes(nodeId)) yield* authorize(nodeId, context);
      }
      return yield* query(() =>
        db.transaction(async (tx) => {
          await tx
            .select()
            .from(nodes)
            .where(eq(nodes.id, initial?.ownerNodeId ?? input.ownerNodeId))
            .for("update");
          const [row] = input.id
            ? await tx
                .select()
                .from(discoveryActivities)
                .where(eq(discoveryActivities.id, input.id))
                .for("update")
            : [];
          const previous = row?.data;
          if (input.id && !previous) throw new ORPCError("NOT_FOUND");
          if (
            previous &&
            (previous.ownerNodeId !== input.ownerNodeId || previous.kind !== input.kind)
          )
            throw new ORPCError("BAD_REQUEST", {
              message: "Activity ownership and kind cannot change",
            });
          if (previous?.luma) {
            const fields = [
              "title",
              "summary",
              "url",
              "source",
              "publishedAt",
              "startsAt",
              "endsAt",
              "timezone",
              "venue",
            ] as const;
            if (fields.some((field) => input[field] !== previous[field]))
              throw new ORPCError("BAD_REQUEST", {
                message: "Edit this event in Luma. Changes appear here automatically.",
              });
            if (!previous.luma.available && input.status !== "draft")
              throw new ORPCError("BAD_REQUEST", {
                message: "This event is no longer public on its Luma calendar.",
              });
          }
          const data = {
            ...input,
            luma: previous?.luma
              ? { ...previous.luma, hidden: input.status !== "published" }
              : undefined,
            id: input.id ?? crypto.randomUUID(),
            nodeIds: [...new Set(input.nodeIds)],
            url: canonicalActivityUrl(input.url),
          };
          const [duplicate] = await tx
            .select()
            .from(discoveryActivities)
            .where(eq(discoveryActivities.canonicalUrl, data.url));
          if (duplicate && duplicate.id !== data.id)
            throw new ORPCError("BAD_REQUEST", {
              message: "This source URL already has an activity",
            });
          await tx
            .insert(discoveryActivities)
            .values({ id: data.id, ownerNodeId: data.ownerNodeId, canonicalUrl: data.url, data })
            .onConflictDoUpdate({
              target: discoveryActivities.id,
              set: { data, canonicalUrl: data.url },
            });
          await tx.insert(discoveryHistory).values({
            nodeId: data.ownerNodeId,
            targetId: data.id,
            actorId: context.userId!,
            action: `${data.kind} ${data.status}`,
          });
          return data;
        }),
      );
    });
  }

  function syncLuma(input: { nodeId: string; calendarId: string }, actorId?: string) {
    return query(() =>
      db.transaction(async (tx) => {
        await tx.select().from(nodes).where(eq(nodes.id, input.nodeId)).for("update");
        const [connection] = await tx
          .select()
          .from(discoveryLumaConnections)
          .where(eq(discoveryLumaConnections.nodeId, input.nodeId));
        if (
          !actorId &&
          (!connection ||
            connection.calendarId !== input.calendarId ||
            connection.nextAttemptAt.getTime() > Date.now())
        )
          return { imported: 0, updated: 0, withdrawn: 0, skipped: 0 };
        const snapshot = await luma.snapshot(input.calendarId);
        const existing = await tx
          .select()
          .from(discoveryActivities)
          .where(eq(discoveryActivities.ownerNodeId, input.nodeId))
          .for("update");
        const importedById = new Map(
          existing.filter((row) => row.data.luma).map((row) => [row.data.luma!.eventId, row]),
        );
        const seen = new Set<string>();
        const result = { imported: 0, updated: 0, withdrawn: 0, skipped: 0 };
        const syncedAt = new Date().toISOString();
        for (const event of snapshot.events) {
          if (seen.has(event.id)) continue;
          seen.add(event.id);
          const previous = importedById.get(event.id);
          const data: DiscoveryActivity = {
            id: previous?.id ?? crypto.randomUUID(),
            ownerNodeId: input.nodeId,
            nodeIds: previous?.data.nodeIds ?? [input.nodeId],
            kind: "event",
            title: event.name.slice(0, 160),
            summary: "Event details and registration are managed on Luma.",
            url: canonicalActivityUrl(event.url),
            source: `Luma · ${snapshot.calendar.name}`.slice(0, 120),
            publishedAt: new Date(event.created_at).toISOString(),
            startsAt: new Date(event.start_at).toISOString(),
            endsAt: new Date(event.end_at).toISOString(),
            timezone: event.timezone,
            venue:
              (event.location_visibility === "public"
                ? event.geo_address_json?.full_address || event.geo_address_json?.city_state
                : null
              )?.slice(0, 240) || "See Luma for location details",
            status: previous?.data.luma?.hidden ? "draft" : "published",
            luma: {
              calendarId: input.calendarId,
              eventId: event.id,
              syncedAt,
              available: true,
              hidden: previous?.data.luma?.hidden,
            },
          };
          const [duplicate] = await tx
            .select()
            .from(discoveryActivities)
            .where(
              and(
                eq(discoveryActivities.canonicalUrl, data.url),
                eq(discoveryActivities.ownerNodeId, input.nodeId),
              ),
            );
          if (duplicate && duplicate.id !== data.id) {
            result.skipped++;
            continue;
          }
          const saved = await tx
            .insert(discoveryActivities)
            .values({ id: data.id, ownerNodeId: input.nodeId, canonicalUrl: data.url, data })
            .onConflictDoNothing()
            .returning();
          if (previous) {
            await tx
              .update(discoveryActivities)
              .set({ data, canonicalUrl: data.url })
              .where(eq(discoveryActivities.id, previous.id));
            result.updated++;
          } else if (saved.length) result.imported++;
          else {
            result.skipped++;
          }
        }
        for (const row of existing) {
          if (!row.data.luma || seen.has(row.data.luma.eventId)) continue;
          await tx
            .update(discoveryActivities)
            .set({
              data: {
                ...row.data,
                status: "draft",
                luma: { ...row.data.luma, syncedAt, available: false },
              },
            })
            .where(eq(discoveryActivities.id, row.id));
          result.withdrawn++;
        }
        await tx
          .insert(discoveryLumaConnections)
          .values({
            nodeId: input.nodeId,
            calendarId: input.calendarId,
            calendarName: snapshot.calendar.name,
            syncedAt: new Date(),
            nextAttemptAt: new Date(Date.now() + 5 * 60_000),
            error: null,
          })
          .onConflictDoUpdate({
            target: discoveryLumaConnections.nodeId,
            set: {
              calendarId: input.calendarId,
              calendarName: snapshot.calendar.name,
              syncedAt: new Date(),
              nextAttemptAt: new Date(Date.now() + 5 * 60_000),
              error: null,
            },
          });
        if (actorId)
          await tx.insert(discoveryHistory).values({
            nodeId: input.nodeId,
            targetId: input.calendarId,
            actorId,
            action: `Luma connected: ${result.imported} imported, ${result.updated} updated, ${result.withdrawn} withdrawn`,
          });
        return result;
      }),
    );
  }

  let syncing = false;
  const syncDueLuma: DiscoveryEffect<void> = Effect.suspend(() => {
    if (syncing) return Effect.void;
    syncing = true;
    return Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const due = yield* query(() =>
        db
          .select()
          .from(discoveryLumaConnections)
          .where(
            lt(
              discoveryLumaConnections.nextAttemptAt,
              DateTime.toDateUtc(DateTime.makeUnsafe(now)),
            ),
          ),
      );
      for (const connection of due) {
        const retryAt = yield* Clock.currentTimeMillis;
        yield* syncLuma(connection).pipe(
          Effect.catch(() =>
            query(() =>
              db
                .update(discoveryLumaConnections)
                .set({
                  error:
                    "Luma is temporarily unavailable. Showing the last saved events; we’ll retry automatically.",
                  nextAttemptAt: DateTime.toDateUtc(DateTime.makeUnsafe(retryAt + 5 * 60_000)),
                })
                .where(
                  and(
                    eq(discoveryLumaConnections.nodeId, connection.nodeId),
                    eq(discoveryLumaConnections.calendarId, connection.calendarId),
                  ),
                ),
            ),
          ),
        );
      }
    }).pipe(Effect.ensuring(Effect.sync(() => (syncing = false))));
  });

  return {
    list: (input: {
      query?: string;
      region?: string;
      active?: boolean;
      upcoming?: boolean;
      nodeId?: string;
    }) => list(input),
    lumaCalendars: (nodeId: string, context: AuthContext) =>
      Effect.gen(function* () {
        yield* authorize(nodeId, context);
        const [connection] = yield* query(() =>
          db
            .select()
            .from(discoveryLumaConnections)
            .where(eq(discoveryLumaConnections.nodeId, nodeId)),
        );
        return {
          ...(yield* query(() => luma.list())),
          connection: connection
            ? {
                calendarId: connection.calendarId,
                calendarName: connection.calendarName,
                syncedAt: connection.syncedAt.toISOString(),
                error: connection.error,
              }
            : null,
        };
      }),
    syncDueLuma,
    importLuma: (input: { nodeId: string; calendarId: string }, context: AuthContext) =>
      Effect.gen(function* () {
        yield* authorize(input.nodeId, context);
        return yield* syncLuma(input, context.userId!);
      }),
    disconnectLuma: (nodeId: string, context: AuthContext) =>
      Effect.gen(function* () {
        yield* authorize(nodeId, context);
        yield* query(() =>
          db.transaction(async (tx) => {
            await tx.select().from(nodes).where(eq(nodes.id, nodeId)).for("update");
            await tx
              .delete(discoveryLumaConnections)
              .where(eq(discoveryLumaConnections.nodeId, nodeId));
            const rows = await tx
              .select()
              .from(discoveryActivities)
              .where(eq(discoveryActivities.ownerNodeId, nodeId));
            for (const row of rows)
              if (row.data.luma)
                await tx
                  .update(discoveryActivities)
                  .set({
                    data: {
                      ...row.data,
                      status: "draft",
                      luma: { ...row.data.luma, available: false },
                    },
                  })
                  .where(eq(discoveryActivities.id, row.id));
            await tx.insert(discoveryHistory).values({
              nodeId,
              targetId: nodeId,
              actorId: context.userId!,
              action: "Luma calendar disconnected",
            });
          }),
        );
        return { disconnected: true };
      }),
    track: (input: DiscoveryMeasurement, context: AuthContext) =>
      Effect.gen(function* () {
        if (
          !input.consent ||
          context.user?.role === "admin" ||
          ["owner", "admin"].includes(context.organization?.member?.role ?? "")
        )
          return { accepted: false };
        if (context.userId) {
          const userId = context.userId;
          const curators = yield* query(() =>
            db.select().from(discoveryCurators).where(eq(discoveryCurators.userId, userId)),
          );
          if (curators.length) return { accepted: false };
        }
        const now = yield* Clock.currentTimeMillis;
        yield* query(() =>
          db
            .delete(discoveryMeasurements)
            .where(
              lt(
                discoveryMeasurements.createdAt,
                DateTime.toDateUtc(DateTime.makeUnsafe(now - 28 * 86400000)),
              ),
            ),
        );
        if (input.kind !== "visit") {
          const [visit] = yield* query(() =>
            db
              .select()
              .from(discoveryMeasurements)
              .where(eq(discoveryMeasurements.key, `${input.visitId}:visit`)),
          );
          if (
            !visit ||
            visit.createdAt.getTime() < now - 30 * 60000 ||
            visit.campaign !== input.campaign
          )
            return { accepted: false };
          const node = yield* eligibleProfile(input.nodeId);
          if (!node) return { accepted: false };
          if (input.kind === "channel" && !node.channels.some((c) => c.url === input.target))
            return { accepted: false };
          if (input.kind === "event") {
            const activity = yield* publicActivity(input.target);
            if (
              !activity ||
              activity.kind !== "event" ||
              activity.status !== "published" ||
              !activity.nodeIds.includes(node.nodeId)
            )
              return { accepted: false };
          }
        }
        const target = input.kind === "channel" || input.kind === "event" ? input.target : "";
        const key =
          input.kind === "visit"
            ? `${input.visitId}:visit`
            : `${input.visitId}:${input.kind}:${input.nodeId}:${target}`;
        yield* query(() =>
          db
            .insert(discoveryMeasurements)
            .values({
              key,
              visitId: input.visitId,
              nodeId: input.kind === "visit" ? null : input.nodeId,
              campaign: input.campaign,
              kind: input.kind,
            })
            .onConflictDoNothing(),
        );
        return { accepted: true };
      }),
    metrics: (context: AuthContext) =>
      Effect.gen(function* () {
        yield* requireCurator(context);
        const since = gte(
          discoveryMeasurements.createdAt,
          DateTime.toDateUtc(DateTime.makeUnsafe((yield* Clock.currentTimeMillis) - 28 * 86400000)),
        );
        const [totals] = yield* query(() =>
          db
            .select({
              visits: sql<number>`count(distinct case when kind = 'visit' then visit_id end)::int`,
              activatedVisits: sql<number>`count(distinct case when kind in ('event', 'channel') then visit_id end)::int`,
            })
            .from(discoveryMeasurements)
            .where(since),
        );
        const rows = yield* query(() =>
          db
            .select({
              nodeId: discoveryMeasurements.nodeId,
              campaign: discoveryMeasurements.campaign,
              kind: discoveryMeasurements.kind,
              count: sql<number>`count(*)::int`,
            })
            .from(discoveryMeasurements)
            .where(since)
            .groupBy(
              discoveryMeasurements.nodeId,
              discoveryMeasurements.campaign,
              discoveryMeasurements.kind,
            ),
        );
        return { visits: totals?.visits ?? 0, activatedVisits: totals?.activatedVisits ?? 0, rows };
      }),
    studio: (context: AuthContext) =>
      Effect.gen(function* () {
        yield* requireCurator(context);
        const isAdmin = context.user?.role === "admin";
        const reports = isAdmin
          ? yield* query(() =>
              db
                .select()
                .from(discoveryReports)
                .orderBy(desc(discoveryReports.createdAt))
                .limit(200),
            )
          : [];
        const curators = isAdmin ? yield* query(() => db.select().from(discoveryCurators)) : [];
        return {
          isAdmin,
          nodes: yield* list({}),
          curators: curators.map((r) => r.userId),
          reports: reports.map(({ token: _token, ...r }) => ({
            ...r,
            createdAt: r.createdAt.toISOString(),
          })),
        };
      }),
    setCurator: (input: { userId: string; enabled: boolean }, context: AuthContext) =>
      Effect.gen(function* () {
        yield* requireAdmin(context);
        if (input.enabled) {
          yield* query(() =>
            db.insert(discoveryCurators).values({ userId: input.userId }).onConflictDoNothing(),
          );
        } else {
          yield* query(() =>
            db.delete(discoveryCurators).where(eq(discoveryCurators.userId, input.userId)),
          );
        }
        return { success: true };
      }),
    feature: (input: { nodeId: string; label: string; expiresAt: string }, context: AuthContext) =>
      Effect.gen(function* () {
        yield* requireCurator(context);
        if (Date.parse(input.expiresAt) > (yield* Clock.currentTimeMillis) + 90 * 86400000) {
          return yield* Effect.fail(
            new ORPCError("BAD_REQUEST", { message: "Feature expiry must be within 90 days" }),
          );
        }
        if (!(yield* eligibleProfile(input.nodeId))) {
          return yield* Effect.fail(new ORPCError("NOT_FOUND"));
        }
        const data = {
          ...input,
          expiresAt: DateTime.toDateUtc(DateTime.makeUnsafe(input.expiresAt)),
        };
        yield* query(() =>
          db
            .insert(discoveryFeatures)
            .values(data)
            .onConflictDoUpdate({ target: discoveryFeatures.nodeId, set: data }),
        );
        return { success: true };
      }),
    report: (input: {
      targetId: string;
      kind: "profile" | "activity";
      reason: string;
      token: string;
    }) =>
      Effect.gen(function* () {
        const activity = input.kind === "activity" ? yield* publicActivity(input.targetId) : null;
        const ownerNodeId = activity?.ownerNodeId ?? input.targetId;
        if (input.kind === "profile" ? !(yield* eligibleProfile(input.targetId)) : !activity) {
          return yield* Effect.fail(new ORPCError("NOT_FOUND"));
        }
        yield* query(() =>
          db.transaction(async (tx) => {
            await tx
              .select({ id: nodes.id })
              .from(nodes)
              .where(eq(nodes.id, ownerNodeId))
              .for("update");
            const recent = await tx
              .select({ id: discoveryReports.id })
              .from(discoveryReports)
              .where(
                and(
                  eq(discoveryReports.targetId, input.targetId),
                  gte(discoveryReports.createdAt, new Date(Date.now() - 3600000)),
                ),
              )
              .limit(20);
            if (recent.length >= 20)
              throw new ORPCError("BAD_REQUEST", {
                message: "This content has already received many reports. Please try again later.",
              });
            await tx.insert(discoveryReports).values(input).onConflictDoNothing();
          }),
        );
        return { success: true };
      }),
    moderate: (
      input: { reportId: string; action: "dismiss" | "unpublish"; note: string },
      context: AuthContext,
    ) =>
      Effect.gen(function* () {
        yield* requireAdmin(context);
        const [report] = yield* query(() =>
          db.select().from(discoveryReports).where(eq(discoveryReports.id, input.reportId)),
        );
        if (!report) {
          return yield* Effect.fail(new ORPCError("NOT_FOUND"));
        }
        yield* query(() =>
          db.transaction(async (tx) => {
            if (input.action === "unpublish") {
              let ownerNodeId: string;
              if (report.kind === "profile") {
                const [row] = await tx
                  .select()
                  .from(discoveryProfiles)
                  .where(eq(discoveryProfiles.nodeId, report.targetId));
                if (!row) throw new ORPCError("NOT_FOUND");
                ownerNodeId = row.nodeId;
                await tx
                  .update(discoveryProfiles)
                  .set({ data: { ...row.data, published: false } })
                  .where(eq(discoveryProfiles.nodeId, report.targetId));
              } else {
                const [row] = await tx
                  .select()
                  .from(discoveryActivities)
                  .where(eq(discoveryActivities.id, report.targetId))
                  .for("update");
                if (!row) throw new ORPCError("NOT_FOUND");
                ownerNodeId = row.ownerNodeId;
                await tx
                  .update(discoveryActivities)
                  .set({
                    data: {
                      ...row.data,
                      status: "draft",
                      luma: row.data.luma ? { ...row.data.luma, hidden: true } : undefined,
                    },
                  })
                  .where(eq(discoveryActivities.id, report.targetId));
              }
              await tx.insert(discoveryHistory).values({
                nodeId: ownerNodeId,
                targetId: report.targetId,
                actorId: context.userId!,
                action: "moderation: unpublish",
              });
            }
            await tx
              .update(discoveryReports)
              .set({ resolved: true, note: input.note })
              .where(eq(discoveryReports.id, report.id));
          }),
        );
        return { success: true };
      }),
    history: (nodeId: string, context: AuthContext) =>
      Effect.gen(function* () {
        yield* authorize(nodeId, context);
        const rows = yield* query(() =>
          db
            .select()
            .from(discoveryHistory)
            .where(eq(discoveryHistory.nodeId, nodeId))
            .orderBy(desc(discoveryHistory.recordedAt))
            .limit(100),
        );
        return rows.map(({ nodeId: _nodeId, ...row }) => ({
          ...row,
          recordedAt: row.recordedAt.toISOString(),
        }));
      }),
    saveActivity,
    activities: (nodeId: string, context: AuthContext) =>
      Effect.gen(function* () {
        yield* authorize(nodeId, context);
        const rows = yield* query(() =>
          db.select().from(discoveryActivities).where(eq(discoveryActivities.ownerNodeId, nodeId)),
        );
        return rows.map((r) => r.data);
      }),
    eventOrganization: (eventId: string) =>
      Effect.gen(function* () {
        const [row] = yield* query(() =>
          db
            .select({ event: discoveryActivities.data, organizationId: tenants.orgId })
            .from(discoveryActivities)
            .innerJoin(nodes, eq(discoveryActivities.ownerNodeId, nodes.id))
            .innerJoin(tenants, eq(nodes.tenantId, tenants.id))
            .where(eq(discoveryActivities.id, eventId)),
        );
        return row ?? null;
      }),
    activity: (id: string) =>
      Effect.gen(function* () {
        yield* Effect.forkDetach(syncDueLuma);
        return yield* publicActivity(id);
      }),
    get: (nodeId: string) =>
      Effect.gen(function* () {
        const results = yield* list({ nodeId });
        return results[0] ?? null;
      }),
    profile: (nodeId: string, context: AuthContext) =>
      Effect.gen(function* () {
        yield* authorize(nodeId, context);
        const [row] = yield* query(() =>
          db.select().from(discoveryProfiles).where(eq(discoveryProfiles.nodeId, nodeId)),
        );
        return row?.data ?? null;
      }),
    saveProfile: (input: DiscoveryProfile, context: AuthContext) =>
      Effect.gen(function* () {
        yield* authorize(input.nodeId, context);
        const [existing] = yield* query(() =>
          db.select().from(discoveryProfiles).where(eq(discoveryProfiles.nodeId, input.nodeId)),
        );
        const previous = existing?.data;
        const geocodedLocation =
          input.geocodedLocation !== undefined
            ? input.geocodedLocation
            : (previous?.geocodedLocation ?? null);
        let next: DiscoveryProfile = {
          ...input,
          geocodedLocation,
          geocodeHint: null,
        };
        if (!next.location.trim()) {
          next = {
            ...next,
            latitude: null,
            longitude: null,
            geocodedLocation: null,
            geocodeHint: null,
          };
        } else if (
          shouldGeocodeProfile({
            location: next.location,
            latitude: next.latitude,
            longitude: next.longitude,
            geocodedLocation,
          })
        ) {
          const geocoded = yield* geocode.geocode(next.location);
          if (geocoded.ok) {
            next = {
              ...next,
              latitude: geocoded.latitude,
              longitude: geocoded.longitude,
              geocodedLocation: next.location.trim(),
              geocodeHint: null,
            };
          } else {
            next = {
              ...next,
              latitude: null,
              longitude: null,
              geocodedLocation: null,
              geocodeHint:
                geocoded.reason === "not_found"
                  ? "Couldn't place that location on the map. Try a clearer city or venue name."
                  : "Map lookup is unavailable right now. Your profile was saved without a pin.",
            };
          }
        }
        yield* query(() =>
          db.transaction(async (tx) => {
            await tx
              .insert(discoveryProfiles)
              .values({ nodeId: next.nodeId, data: next })
              .onConflictDoUpdate({ target: discoveryProfiles.nodeId, set: { data: next } });
            await tx.insert(discoveryHistory).values({
              nodeId: next.nodeId,
              targetId: next.nodeId,
              actorId: context.userId!,
              action: next.published ? "profile published" : "profile saved as draft",
            });
          }),
        );
        return next;
      }),
  };
}
export type DiscoveryService = ReturnType<typeof createDiscovery>;
export class DiscoveryTag extends Context.Service<DiscoveryTag, DiscoveryService>()(
  "api/Discovery",
) {}
export const DiscoveryLive = (lumaKeys = "") =>
  Layer.effect(
    DiscoveryTag,
    Effect.gen(function* () {
      const service = createDiscovery(yield* DatabaseTag, lumaKeys, yield* GeocodeTag);
      yield* Effect.forkScoped(
        service.syncDueLuma.pipe(Effect.ignore, Effect.repeat(Schedule.spaced("60 seconds"))),
      );
      return service;
    }),
  );
