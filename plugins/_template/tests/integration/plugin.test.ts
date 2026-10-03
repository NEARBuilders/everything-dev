import { describe, expect, it } from "vitest";
import { getPluginClient } from "../setup";

describe("Template Plugin Integration Tests", () => {
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

      await expect(client.getThing({ thingId: "missing-thing" })).rejects.toThrow("not found");
    });
  });
});
