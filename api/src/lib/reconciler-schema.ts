import { z } from "zod";

export const ReconcilerStatusSchema = z.object({
  enabled: z.boolean(),
  pollIntervalMs: z.number().int(),
  namespaces: z.array(
    z.object({
      account: z.string(),
      gateway: z.string(),
      instance: z.string(),
      lastSeenDigest: z.string().optional(),
      convergedDigest: z.string().optional(),
      bootAssumed: z.boolean(),
      drift: z
        .object({
          reason: z.string(),
          at: z.string(),
        })
        .optional(),
      instanceUrl: z.string().optional(),
      lastCheckedAt: z.string().optional(),
      lastConvergedAt: z.string().optional(),
    }),
  ),
});
