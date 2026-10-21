/**
 * Request context schema — the auth context the host injects per request.
 *
 */

import { z } from "zod";
import type { AuthPluginContext as AuthContext } from "./auth-types.gen";

export const ContextSchema = z.custom<AuthContext>();

export type Context = AuthContext;
