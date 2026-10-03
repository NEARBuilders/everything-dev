import { z } from "zod";

export const notesContract = {
  listNotes: {
    input: z.object({ limit: z.number().int().min(1).max(100).default(24) }),
    output: z.array(z.object({ id: z.string(), body: z.string() })),
  },
  createNote: {
    input: z.object({ body: z.string().min(1) }),
    output: z.object({ id: z.string() }),
  },
} as const;

export type NotesContract = typeof notesContract;
