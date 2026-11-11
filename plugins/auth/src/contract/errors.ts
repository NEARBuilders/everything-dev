import type { ORPCErrorConstructorMap } from "@orpc/contract";
import {
  BAD_REQUEST,
  FORBIDDEN,
  NOT_FOUND,
  SERVICE_UNAVAILABLE,
  UNAUTHORIZED,
} from "every-plugin/errors";
import { z } from "zod";

export const Errors = {
  UNAUTHORIZED,
  FORBIDDEN,
  NOT_FOUND,
  BAD_REQUEST,
  SERVICE_UNAVAILABLE,
} as const;

export type AuthErrors = ORPCErrorConstructorMap<typeof Errors>;

const CODE_NOT_FOUND = {
  status: 404,
  data: z.object({ codeId: z.string().optional() }),
} as const;

const CODE_REVOKED = {
  status: 403,
  data: z.object({}),
} as const;

const CODE_EXPIRED = {
  status: 400,
  data: z.object({ expiresAt: z.string().datetime().optional() }),
} as const;

const CODE_EXHAUSTED = {
  status: 403,
  data: z.object({ maxUses: z.number().int().optional() }),
} as const;

const ORG_NOT_FOUND = {
  status: 400,
  data: z.object({}),
} as const;

const ORG_FULL = {
  status: 403,
  data: z.object({}),
} as const;

const MEMBERSHIP_ENDED = {
  status: 403,
  data: z.object({ action: z.string() }),
} as const;

const ALREADY_MEMBER = {
  status: 400,
  data: z.object({ organizationId: z.string().optional() }),
} as const;

export const OnboardingErrors = {
  ...Errors,
  CODE_NOT_FOUND,
  CODE_REVOKED,
  CODE_EXPIRED,
  CODE_EXHAUSTED,
  ORG_NOT_FOUND,
  ORG_FULL,
  MEMBERSHIP_ENDED,
} as const;

export const InvitationErrors = {
  ...Errors,
  ALREADY_MEMBER,
} as const;
