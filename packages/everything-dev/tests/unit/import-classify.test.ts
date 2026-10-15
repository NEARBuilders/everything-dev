import { describe, expect, it } from "vitest";
import { classifyImportFile } from "../../src/cli/import";

describe("bos import — classifyImportFile", () => {
  it("classifies a missing local file as added", () => {
    expect(
      classifyImportFile({
        localHash: null,
        upstreamHash: "u",
        baselineHash: undefined,
        mergeable: false,
      }),
    ).toEqual({ kind: "added" });
  });

  it("classifies identical content as unchanged", () => {
    expect(
      classifyImportFile({
        localHash: "same",
        upstreamHash: "same",
        baselineHash: "old",
        mergeable: false,
      }),
    ).toEqual({ kind: "unchanged" });
  });

  it("reports a no-baseline conflict when the baseline is unknown", () => {
    expect(
      classifyImportFile({
        localHash: "local",
        upstreamHash: "up",
        baselineHash: undefined,
        mergeable: false,
      }),
    ).toEqual({ kind: "conflict", reason: "no-baseline" });
  });

  it("merges package.json on first import even without a baseline", () => {
    expect(
      classifyImportFile({
        localHash: "local",
        upstreamHash: "up",
        baselineHash: undefined,
        mergeable: true,
      }),
    ).toEqual({ kind: "merged" });
  });

  it("updates when local matches the baseline and upstream moved", () => {
    expect(
      classifyImportFile({
        localHash: "base",
        upstreamHash: "new",
        baselineHash: "base",
        mergeable: false,
      }),
    ).toEqual({ kind: "updated" });
  });

  it("merges instead of raw overwriting when local matches a previously merged baseline", () => {
    expect(
      classifyImportFile({
        localHash: "merged-state",
        upstreamHash: "up",
        baselineHash: "merged-state",
        mergeable: true,
      }),
    ).toEqual({ kind: "merged" });
  });

  it("preserves local edits when upstream matches the baseline", () => {
    expect(
      classifyImportFile({
        localHash: "edited",
        upstreamHash: "base",
        baselineHash: "base",
        mergeable: false,
      }),
    ).toEqual({ kind: "preserved-local-edit" });
  });

  it("reports a both-changed conflict", () => {
    expect(
      classifyImportFile({
        localHash: "edited",
        upstreamHash: "moved",
        baselineHash: "base",
        mergeable: false,
      }),
    ).toEqual({ kind: "conflict", reason: "both-changed" });
  });

  it("merges rather than conflicts when a mergeable file changed on both sides", () => {
    expect(
      classifyImportFile({
        localHash: "edited",
        upstreamHash: "moved",
        baselineHash: "base",
        mergeable: true,
      }),
    ).toEqual({ kind: "merged" });
  });
});
