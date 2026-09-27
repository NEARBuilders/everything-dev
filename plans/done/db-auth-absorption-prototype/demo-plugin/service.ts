import type { DriverClient } from "../facade/db";

export function createNotesService(db: DriverClient) {
  return {
    async listNotes(limit: number) {
      const result = await db.query(`SELECT id, body FROM notes ORDER BY id LIMIT ${limit}`);
      return result.rows as Array<{ id: string; body: string }>;
    },
    async createNote(body: string) {
      const result = await db.query(
        `INSERT INTO notes (body) VALUES ('${body.replace(/'/g, "''")}') RETURNING id`,
      );
      return { id: String((result.rows[0] as { id: unknown }).id) };
    },
  };
}

export type NotesService = ReturnType<typeof createNotesService>;
