import { describe, expect, it } from "vitest";
import { getPluginClient } from "../setup";

describe("Template Plugin Integration Tests", () => {
  describe("getById procedure", () => {
    it("should fetch item successfully when authenticated", async () => {
      const client = await getPluginClient({ userId: "user123" });

      const result = await client.getById({ id: "test-123" });

      expect(result.item).toEqual({
        id: "test-123",
        title: "Item test-123",
        createdAt: expect.any(String),
      });
      expect(result.userId).toBe("user123");
    });

    it("should reject unauthorized access without userId", async () => {
      const client = await getPluginClient();

      await expect(client.getById({ id: "test-123" })).rejects.toThrow("User ID required");
    });

    it("should handle not found error", async () => {
      const client = await getPluginClient({ userId: "user123" });

      await expect(client.getById({ id: "not-found" })).rejects.toThrow(
        "Failed to fetch item: Item not found",
      );
    });
  });

  describe("search procedure", () => {
    it("should stream search results", async () => {
      const client = await getPluginClient();

      const stream = await client.search({ query: "test-query", limit: 3 });

      const results = [];
      for await (const result of stream) {
        results.push(result);
      }

      expect(results).toHaveLength(3);
      expect(results[0]).toEqual({
        item: {
          id: "test-query-0",
          title: "test-query result 1",
          createdAt: expect.any(String),
        },
        score: 1,
      });
      expect(results[1]?.score).toBe(0.9);
      expect(results[2]?.score).toBe(0.8);
    });

    it("should respect limit parameter", async () => {
      const client = await getPluginClient();

      const stream = await client.search({ query: "limited", limit: 2 });

      const results = [];
      for await (const result of stream) {
        results.push(result);
      }

      expect(results).toHaveLength(2);
    });
  });

  describe("ping procedure", () => {
    it("should return healthy status", async () => {
      const client = await getPluginClient();

      const result = await client.ping();

      expect(result).toEqual({
        status: "ok",
        timestamp: expect.any(String),
      });
    });
  });

  describe("things CRUD", () => {
    it("should create, read, list, and delete a thing", async () => {
      const client = await getPluginClient({ userId: "user123" });

      const created = await client.createThing({
        thingId: "thing-abc",
        payload: { kind: "note", text: "hello world" },
      });
      expect(created).toMatchObject({
        thingId: "thing-abc",
        type: "template.note",
        payload: { kind: "note", text: "hello world" },
        action: "template.note.created",
      });

      const fetched = await client.getThing({ thingId: "thing-abc" });
      expect(fetched.thingId).toBe("thing-abc");

      const listed = await client.listThings({ limit: 10 });
      expect(listed.data.map((t) => t.thingId)).toContain("thing-abc");

      const deleted = await client.deleteThing({ thingId: "thing-abc" });
      expect(deleted).toEqual({ success: true });
    });

    it("should reject create duplicate with CONFLICT", async () => {
      const client = await getPluginClient({ userId: "user123" });

      await client.createThing({ thingId: "dup-id", payload: { kind: "note" } });
      await expect(
        client.createThing({ thingId: "dup-id", payload: { kind: "note" } }),
      ).rejects.toThrow("already exists");
    });

    it("should reject fetching a missing thing with NOT_FOUND", async () => {
      const client = await getPluginClient({ userId: "user123" });

      await expect(client.getThing({ thingId: "missing-thing" })).rejects.toThrow(
        "not found",
      );
    });
  });
});
