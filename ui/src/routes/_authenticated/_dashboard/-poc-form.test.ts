// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildPocFormValues,
  loadPocFormDraft,
  POC_FORM_DEFAULTS,
  pocFormStorageKey,
  usePocForm,
} from "./-poc-form";

const ORG_A = "org-a";
const ORG_B = "org-b";
const KEY_A = pocFormStorageKey(ORG_A);
const KEY_B = pocFormStorageKey(ORG_B);

beforeEach(() => {
  localStorage.clear();
});

afterEach(cleanup);

describe("buildPocFormValues", () => {
  it("returns the defaults when no prefill or draft exists", () => {
    expect(buildPocFormValues(ORG_A)).toEqual(POC_FORM_DEFAULTS);
  });

  it("layers prefill under the persisted draft", () => {
    localStorage.setItem(KEY_A, JSON.stringify({ pool: "draft.pool.near" }));
    const values = buildPocFormValues(ORG_A, { pool: "assigned.pool.near", name: "Thing" });
    expect(values.pool).toBe("draft.pool.near");
    expect(values.name).toBe("Thing");
  });

  it("keeps drafts isolated per organization", () => {
    localStorage.setItem(KEY_A, JSON.stringify({ name: "Node A" }));
    localStorage.setItem(KEY_B, JSON.stringify({ name: "Node B" }));
    expect(buildPocFormValues(ORG_A).name).toBe("Node A");
    expect(buildPocFormValues(ORG_B).name).toBe("Node B");
  });

  it("applies prefill for a null organization without touching storage", () => {
    expect(buildPocFormValues(null, { name: "Thing" }).name).toBe("Thing");
    expect(buildPocFormValues(null)).toEqual(POC_FORM_DEFAULTS);
  });
});

describe("loadPocFormDraft", () => {
  it("returns null without an organization or a stored draft", () => {
    expect(loadPocFormDraft(null)).toBeNull();
    expect(loadPocFormDraft(ORG_A)).toBeNull();
  });

  it("ignores corrupt drafts", () => {
    localStorage.setItem(KEY_A, "{not json");
    expect(loadPocFormDraft(ORG_A)).toBeNull();
  });
});

describe("usePocForm", () => {
  it("persists edits under the active organization", async () => {
    const { result } = renderHook(({ orgId }) => usePocForm(orgId, buildPocFormValues(orgId)), {
      initialProps: { orgId: ORG_A },
    });
    await act(async () => {
      result.current.setFieldValue("pool", "a.pool.near");
    });
    expect(JSON.parse(localStorage.getItem(KEY_A) ?? "{}")).toMatchObject({
      pool: "a.pool.near",
    });
  });

  it("does not carry one organization's values into the next on switch", async () => {
    localStorage.setItem(KEY_B, JSON.stringify({ pool: "b.pool.near" }));
    const { result, rerender } = renderHook(
      ({ orgId }) => usePocForm(orgId, buildPocFormValues(orgId)),
      { initialProps: { orgId: ORG_A } },
    );
    await act(async () => {
      result.current.setFieldValue("pool", "a.pool.near");
    });
    rerender({ orgId: ORG_B });
    expect(JSON.parse(localStorage.getItem(KEY_B) ?? "{}")).toMatchObject({
      pool: "b.pool.near",
    });
  });
});
