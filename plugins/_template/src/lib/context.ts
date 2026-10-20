/**
 * FRAMEWORK-OWNED — reconciled from the parent template by `bos sync` / `bos upgrade`.
 * Local edits are allowed: on the next sync the template version wins and your copy
 * is backed up under `.bos/sync-backup/`. To make a change permanent, file an issue:
 * https://github.com/NEARBuilders/everything-dev/issues
 */
/**
 * Request context schema — the auth context the host injects per request.
 *
 */

import { z } from "zod";
import type { AuthPluginContext as AuthContext } from "./auth-types.gen";

export const ContextSchema = z.custom<AuthContext>();

export type Context = AuthContext;
