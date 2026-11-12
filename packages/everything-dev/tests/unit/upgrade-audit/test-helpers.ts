import type { Finding } from "../../../src/services/scaffold/upgrade-audit/domain";

export const blockerMessages = (findings: readonly Finding[]): string[] =>
  findings.filter((f) => f.severity === "blocker").map((f) => f.message);

export const warnMessages = (findings: readonly Finding[]): string[] =>
  findings.filter((f) => f.severity === "warn").map((f) => f.message);
