import type { ORPCErrorConstructorMap } from "@orpc/contract";
import {
  BAD_REQUEST,
  FORBIDDEN,
  NOT_FOUND,
  SERVICE_UNAVAILABLE,
  UNAUTHORIZED,
} from "every-plugin/errors";

export const Errors = {
  UNAUTHORIZED,
  FORBIDDEN,
  NOT_FOUND,
  BAD_REQUEST,
  SERVICE_UNAVAILABLE,
} as const;

export type AuthErrors = ORPCErrorConstructorMap<typeof Errors>;
